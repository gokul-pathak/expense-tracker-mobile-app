# M8C Recurring transaction engine

A recurring template is a plan to record the same expense or income on a schedule — rent on the 1st,
salary every month, a subscription every year. M8C is the engine: the tables, the calendar, what is
due, generating and skipping, and how all of it synchronizes and backs up. There is no recurring UI,
no automatic generation and no notification. M8D builds the screens that call this engine.

## The one rule everything follows from

**A template is not a transaction.** Creating one writes a planning row and nothing else. No
balance, report, budget or receivable reads the templates table. Money moves only when an
occurrence is generated, and what that produces is an ordinary row in `transactions`, built by the
transaction service under exactly the rules a hand-entered expense or income meets. There is no
second accounting path anywhere.

## Schedules

Only `expense` and `income` repeat. A recurring transfer, loan or repayment would need the transfer
and debt invariants re-checked at every generation, and a skipped repayment has no obvious meaning,
so those stay manual.

| Frequency | Every `interval` units | Anchored to                                |
| --------- | ---------------------- | ------------------------------------------ |
| `daily`   | days                   | the start date                             |
| `weekly`  | weeks (7 days)         | the start date's weekday                   |
| `monthly` | months                 | the start date's day of the month, clamped |
| `yearly`  | years                  | the start date's month and day, clamped    |

`interval` is 1 to 999. There is no RRULE, no weekday set, no "last business day" and no time of
day: a schedule is a list of calendar dates.

- **`startDate` is the first occurrence.**
- **`endDate` is inclusive** and optional. A date after it does not exist. An end date before the
  start is refused.
- **Dates are `YYYY-MM-DD` text**, never instants. "Rent on the 1st" is the 1st on every device in
  every time zone. Arithmetic is whole days in the proleptic Gregorian calendar
  (`recurring-schedule.ts`), so a daylight-saving change cannot turn a day into 23 hours and move an
  occurrence to the wrong date.

### Clamping, and why February does not drift

A monthly or yearly date that does not exist in a month uses that month's last day, and the next
month returns to the anchor. Every occurrence is computed from the start date, never from the
previous occurrence:

```text
start 2026-01-31, monthly   ->  Jan 31, Feb 28, Mar 31, Apr 30, May 31
start 2028-02-29, yearly    ->  2028-02-29, 2029-02-28, 2030-02-28, 2031-02-28, 2032-02-29
```

Computing from the previous occurrence would make February the new anchor and leave rent on the 28th
forever. The leap-day case is the same rule, not a special case.

## What is due

**Due is derived, never stored.** A due occurrence is a scheduled date that is on or after the start,
on or before the as-of date, on or before the end date, belongs to a live, unpaused template, and has
no occurrence row yet. Nothing is materialised in advance; asking about a template with no end date
does not enumerate forever, because every caller bounds the walk.

`listDueOccurrences({ asOfDate, limit })` returns at most `limit` (1–100, default 100) dates, oldest
first across every template, with `hasMore`. Ordering is by date, then template identity, then local
id, so the answer is the same on every read. A long-missed date is never pushed out by a recent one.

A due date whose template can no longer generate is still returned, with a `blockedReason`:

| Reason                   | Meaning                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `account_archived`       | the template's account is archived                          |
| `account_deleted`        | the template's account no longer exists                     |
| `category_deleted`       | the template's category no longer exists                    |
| `category_type_mismatch` | the category is of the other type                           |
| `currency_mismatch`      | the account's currency is no longer the template's currency |

A blocked date is not skipped and nothing is generated against a different account. Fixing it is a
person's decision, which M8D will surface.

Every entry point takes an `asOfDate`. Omitted, it is this device's local calendar date. The engine
never reads a clock it was not given, and it never runs by itself: there is no startup hook, timer,
background task or notification.

## Generating and skipping

`generateOccurrence(templateId, date)` checks the template, that the date is on its schedule and has
arrived, that the template is not paused and the date not already decided, and that the account and
category still allow it. It then builds the transaction through `prepareGeneratedTransaction` — the
same function `createExpense` and `createIncome` use — and writes, in **one SQLite transaction**:

```text
the occurrence row (status generated)   +  its outbox entry
the transaction                         +  its outbox entry
```

Either all four commit or none do. There is no state in which a date is marked generated without its
transaction, or a generated transaction exists that no occurrence accounts for.

- **`transactionDate` is the scheduled date**, not today. Rent due on the 30th and recorded on the 3rd
  belongs to the 30th's month, report and budget. It is stamped at local noon, the instant least
  likely to read as a different day in another time zone. `createdAt` is when it was recorded.
- **Generating is idempotent.** A date already generated returns what exists and writes nothing.
- **A future date is refused.** M8C generates nothing in advance.

`skipOccurrence(templateId, date)` writes one occurrence row with status `skipped`, and its outbox
entry, atomically. No transaction, balance, report or budget moves. Skipping twice returns the
existing decision.

| Asked to… | when the date is…    | Result                                           |
| --------- | -------------------- | ------------------------------------------------ |
| generate  | already generated    | returns it (`already_generated`), writes nothing |
| generate  | skipped              | refused: `occurrence_already_skipped`            |
| skip      | already skipped      | returns it (`already_skipped`), writes nothing   |
| skip      | generated            | refused: `occurrence_already_generated`          |
| either    | on a paused template | refused: `template_paused`                       |

Undoing a skip is deliberately absent; a later milestone can add it as an explicit action.

`generateDueOccurrences({ asOfDate, limit })` works through the due list one occurrence at a time,
each its own atomic write, and reports `generated`, `alreadyHandled`, `blocked` and `failed`. One
archived account blocks its own dates and nothing else.

## Pausing and resuming

A paused template keeps its history and appears in no due list. **Resuming does not forgive the dates
that passed while it was paused**: they are due again the moment it resumes, and each can be generated
or skipped. Discarding them silently would decide on someone's behalf that a rent payment did not
happen.

## Editing and deleting

Editing changes future generation only. A transaction already generated keeps its amount, category
and account whatever the template says afterwards, and remains editable like any other transaction.

- Amount, category, account, payment mode, title, note and end date are editable at any time. The end
  date cannot move before a date that was already handled.
- **The schedule — start, frequency, interval — is editable only until a date is handled.** After
  that it is locked (`schedule_locked`): moving it would leave a decision describing a date the
  template no longer has.
- The type never changes. An expense template does not become an income template.

**Deleting a template stops the schedule and nothing else.** Its occurrences and the transactions
they produced stay exactly as they are.

**Deleting a generated transaction does not bring its date back.** The occurrence stays `generated`,
meaning "this date was handled", and the engine never regenerates it. Otherwise a deletion would
quietly reappear on the next run.

## Identity across devices

Two phones, both offline, both generate rent for September 1. Each derives the same identities, so
the cloud's identity-keyed upsert converges them on one occurrence and one transaction:

```text
occurrence  = UUIDv5(NAMESPACE, "recurring-occurrence:{templateSyncId}:{YYYY-MM-DD}")
transaction = UUIDv5(NAMESPACE, "transaction:{occurrenceSyncId}")

NAMESPACE   = 1d5f200c-290b-4d0a-b974-54b7f2729dfb
```

The namespace is not secret and **must never change**: every identity already recorded was derived
from it, and a new one would give handled dates new identities on the next device to derive them.
The inputs are the template's identity and the date and nothing else — an amount or a category can
be edited, and an identity built from them would change when they did.

UUIDv5 comes from the `uuid` package (11.1.1), never a hand-rolled hash. Metro resolves it to the
package's pure-JavaScript SHA-1 build and Node to its crypto-backed one;
`test/recurring/recurring-identity.test.ts` checks both against the RFC's published example and an
independent SHA-1 computation. `SYNC_ID_PATTERN` accepts version 4 (random, every ordinary record)
and version 5 (these two). Templates and hand-entered transactions keep random identities.

## Sync

Two entity types join the outbox and the cloud: `recurring_template` and `recurring_occurrence`. A
generated transaction is an ordinary `transaction` carrying `recurring_occurrence_sync_id`. The link
lives on the child only, so the two rows cannot disagree and there is no foreign-key cycle.

**Upload order**: accounts and categories, then templates, then occurrences, then transactions.
A template's tombstone goes up with its upserts rather than at the end: for a template created, used
and deleted between two pushes, that tombstone is the only upload that ever tells the cloud it
existed, and its occurrence's foreign key needs it there first.

**Download order** mirrors it. A template or occurrence that arrives already deleted and is unknown
locally is still written, as a tombstone, because the transactions it produced point at it — a
template created, used and deleted while a device was away would otherwise stall that device's
download forever.

A downloaded occurrence must carry the identity derived from its template and date, and a generated
transaction the identity derived from its occurrence; anything else is refused. Whether an occurrence
is still on its template's schedule is not checked: a template can be rescheduled on one device while
another handles a date from the old schedule offline, and refusing that record would stall the
download behind it. An off-schedule decision is harmless because the due engine only walks the
schedule's own dates.

### Conflicts

Templates use the ordinary M7 rules: last write wins for edits, delete wins over an edit.

Occurrences add one rule: **generated wins over skipped.** One device generated the rent; another,
offline, skipped it. A real transaction exists, and a stale skip must not erase the record of it. The
cloud enforces this with a trigger that refuses to turn a generated occurrence back into a skipped
one, in either upload order; the client applies the same rule on download, and replaces a not-yet
uploaded local skip with a downloaded generation in the same pull (recorded as `remote_wins`,
`generated_wins`). Either way there is one transaction, never two.

A template deleted on one device while another generated one of its dates offline: the template stays
deleted, and the generated occurrence and transaction are kept. A deletion stops future recurrence;
it does not unmake money that moved.

## Backup

Backup format **4** adds `recurringTemplates`, `recurringOccurrences` and each transaction's
`recurringOccurrenceId`. Versions 3, 2 and 1 still restore, with no recurring data. Nothing derived is
stored — no next due date, no due list — because it is recomputed from the schedule and the decisions,
and comes out the same.

A deleted template's history is not carried: it schedules nothing, so its record of handled dates has
nothing left to protect. The transactions it produced are kept as ordinary transactions, without a
link to a template the backup does not contain.

## Deliberately absent

Recurring UI, automatic or background generation, notifications, realtime, recurring transfers,
loans and repayments, generating in advance, undoing a skip, rollover, and any link between a
recurring template and a budget. M8D owns the interface.
