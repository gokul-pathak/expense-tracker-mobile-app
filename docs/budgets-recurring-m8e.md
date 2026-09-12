# Budgets and recurring transactions: the settled rules (M8E)

What M8A–M8D built, stated as rules rather than as a change log, so that a future change can be
checked against them. M8E added no features. It audited these rules, pinned the ones that were only
implicitly tested, and extended the local integrity audit to cover the cases nothing was checking.

The one sentence the rest of this document elaborates: **a budget and a recurring template are
plans, and a plan is not money.** Only an ordinary `income` or `expense` row in `transactions` ever
moves a balance, a report, a budget or a receivable.

## Budgets

### What a budget is

A budget is a planning row: a month, a currency, an amount, and either a category or nothing at all
(the overall budget). It creates no transaction and changes no balance.

**Spending is never stored.** `spent`, `remaining`, `percentage` and `status` are derived from the
month's expense transactions on every read, by one grouped SQL aggregate. Nothing writes them down,
locally or in the cloud, so a budget cannot drift out of step with the records it describes. Both
the backup format and the cloud schema omit them deliberately.

### Monthly semantics

- A month is `YYYY-MM` — an identity, not an instant. A timestamp would make two devices in
  different time zones disagree about which month a plan belongs to.
- The range a month covers is half-open, `start <= transactionDate < end`, computed in the asking
  device's local calendar. No expense falls in two months, and none falls between them.
- A budget is measured on `transactionDate` — the day the money moved — never on when the row
  happened to be written. An expense entered in October and dated September belongs to September.
- A report over part of a month gets no budget comparison at all rather than a prorated one: a
  fraction of a plan is a figure the user never set.

### Currency

A budget counts only expenses in its own currency, matched exactly. Amounts in different currencies
are never added together, because their sum is not a quantity of anything.

Changing the default currency in Settings affects only budgets created afterwards. A historical
budget keeps the currency it was created in.

### The states, and the boundary that matters

`unused` (nothing spent), `within_budget`, `at_budget`, `over_budget`. The boundary between the last
two is exact: spending precisely to the limit has **reached** it, not exceeded it — remaining is 0,
overspent is 0, progress is 100%, and the status is `at_budget`.

The percentage is uncapped. Spending 100,000 against a 1,000 plan is 10,000%, and that is what the
domain reports. A progress bar may stop at 100%; that is a presentation choice and never changes
the figure.

### Overall versus category

The overall budget is the plan for everything spent that month. The category budgets are plans for
scopes inside it. They are **not** summed: a month with an overall 50,000 and category plans of
15,000 and 10,000 has a total budget of 50,000, not 75,000. `categoryBudgetedMinor` reports the
category total separately, and it is labelled as such wherever it is shown.

A month with no budget has no limit. It is never presented as a limit of zero, and never as
overspent.

### No rollover, no alerts, no forecasting

An unused amount in September does not change October. There is no rollover, no notification, and
no trend projection or advice. `over_budget` is arithmetic, not a judgement. These remain out of
scope deliberately.

### Uniqueness

One live budget per user, month, currency and category. This is enforced in three places: the
domain, a partial unique index in SQLite, and a partial unique index in PostgreSQL.

The overall budget's null category is the trap. In both SQLite and PostgreSQL a unique index treats
distinct nulls as distinct, so `unique (month, currency, category)` would let a month accumulate any
number of overall budgets. Both indexes therefore collapse null onto a sentinel —
`coalesce(category_id, -1)` locally, `coalesce(category_sync_id, '000…0'::uuid)` in the cloud — and
both are partial (`where deleted_at is null`) so that a deleted plan stops occupying its month.

## Recurring transactions

### What a template is

A template is a plan to record the same expense or income on a schedule. It has no financial effect
of any kind, and no balance, report, budget or receivable reads the table.

Only `expense` and `income` recur. Transfers, lending, borrowing and repayments stay manual: a
recurring transfer would need the transfer invariants re-checked at every generation, and a skipped
repayment has no obvious meaning.

### Frequencies and the calendar

`daily`, `weekly`, `monthly`, `yearly`, each with an interval of "every N", and an optional
inclusive end date.

All arithmetic is on calendar dates (`YYYY-MM-DD`) counted as whole days from 1970-01-01, never on
instants. Adding a day adds one day — not 86,400,000 milliseconds, which a daylight-saving change
would turn into 23 or 25 hours and, near midnight, into the wrong date.

**Clamping, and why it does not drift.** Monthly and yearly are anchored to the start date's day of
month. A month too short for that day uses its last day, and the _next_ month returns to the anchor.
Every occurrence is computed **from the start date**, never from the previous occurrence, which is
what stops February from dragging the schedule onto the 28th forever:

| Start         | Sequence                                                                    |
| ------------- | --------------------------------------------------------------------------- |
| Jan 31        | Jan 31, Feb 28/29, **Mar 31**, Apr 30, May 31                               |
| Jan 30        | Jan 30, Feb 28/29, **Mar 30**, Apr 30                                       |
| Jan 29        | Jan 29, Feb 28 (common) / Feb 29 (leap), **Mar 29**                         |
| Jan 28        | Jan 28, Feb 28, Mar 28 — the 28th exists everywhere, so nothing ever clamps |
| Feb 29 yearly | 2028-02-29, 2029-02-28, 2030-02-28, 2031-02-28, **2032-02-29**              |

A yearly February 29 is the same clamping rule, not a special case. The leap rule includes the
century exception: 2100 is not a leap year, so a four-yearly Feb 29 from 2096 gives 2096-02-29,
2100-02-28, 2104-02-29.

Weekly stays on the start's weekday, because seven days is always seven days.

### Due, generated, skipped

What is due is **derived, never stored**: the template's schedule, minus the dates already handled.
A date nobody has handled has no row, so the table never fills with dates that have not happened.

An occurrence row records one decision about one date — `generated` or `skipped`. Neither is money.
A generated occurrence's financial effect is an ordinary transaction in `transactions`,
indistinguishable in every calculation from one a person typed in, carrying only a
`recurring_occurrence_id` as provenance. There is no `recurring_expense` type and no separate
recurring balance logic.

Enumeration is bounded (`DUE_OCCURRENCE_LIMIT`, 100) and chronological across templates, so a
long-missed date is never pushed out by a recent one. What does not fit is reported through
`hasMore`, never silently dropped. Nothing runs by itself: there is no timer, no midnight scheduler,
no OS background task and no notification. A person asks what is due and decides what to do.

### Generation identity, and why duplicates are impossible

Two phones, both offline, both showing "Rent due September 1". If each gave the rent a random
identity the cloud would faithfully keep both, and the rent would be paid twice on paper. No
conflict handling afterwards can fix that, because by then they genuinely are two records.

So identity is computed, not chosen — a version 5 UUID derived in a fixed namespace:

- occurrence: `recurring-occurrence:{templateSyncId}:{YYYY-MM-DD}`
- its transaction: `transaction:{occurrenceSyncId}`

Both devices derive the same values, the cloud's identity-keyed upsert converges them into one row,
and the rent is recorded once. The inputs are the template's identity and the date and nothing else:
an amount or a category can be edited, and an identity built from them would change when they did.

The namespace constant is part of the data format, like a column name. Changing it would make a
device derive new identities for dates already handled — exactly the duplication it prevents.

Three further defences back this up, none of them a disabled button:

- `unique (template_id, occurrence_date)` — one decision per date, outright.
- `unique (recurring_occurrence_id)` on `transactions` — one transaction per occurrence, outright.
- Generation is one SQLite transaction covering the occurrence, its queue entry and the
  transaction, so a crash leaves either all of it or none of it.

Generating an already-generated date writes nothing and returns what exists. Skipping twice returns
the existing decision.

### Conflict rules across devices

| Situation                                                        | Outcome                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Both devices generate the same date offline                      | One occurrence, one transaction                                                                                                    |
| One generates, the other skips                                   | **Generated wins**, in either upload order                                                                                         |
| Both edit the same template                                      | The M7 record-level rule picks one winner; never two templates                                                                     |
| One deletes, the other edits                                     | **Delete wins**; no resurrection                                                                                                   |
| One deletes the template, the other generates a due date offline | The template stays deleted and produces nothing further; the transaction already generated **is kept**, as an ordinary transaction |
| One pauses, the other generates offline                          | Pause stops future offering; the generated transaction is kept                                                                     |

The principle behind the last two: a plan can be withdrawn, but a record of money that was recorded
is not withdrawn as a side effect of withdrawing the plan.

### Pause, resume, edit, delete

- Pausing keeps history and produces nothing new. Resuming does **not** forgive the dates that
  passed while paused — they are outstanding again, and each can be generated or skipped. Silently
  discarding them would decide on someone's behalf that a rent payment did not happen.
- Editing changes the plan for dates not yet handled. A transaction already generated keeps its
  amount, category and account whatever the template says afterwards.
- The schedule itself (start, frequency, interval) can change only while no date has been handled.
  Afterwards, "which of these handled dates still count" is not a question to answer by guessing.
- Deleting a template stops the schedule and keeps every transaction it produced.
- Deleting a generated transaction leaves the occurrence handled. The date is never offered again
  and never regenerates.

### Scheduled date versus transaction date

These are different facts and are never conflated.

- The occurrence's date means **scheduled for X**.
- The transaction's `transactionDate` means **recorded for Y**.

Generation sets the second from the first (at local noon, the instant furthest from both midnights
and so least likely to read as a different day, month or budget in another time zone). If the user
afterwards edits the transaction's date, the money moves to the new month for budgets and reports,
and the occurrence's scheduled date is **not** rewritten. Rewriting it would give the template a
date it never had, and make the real scheduled date due all over again.

### Blocked generation

A due date whose template can no longer generate — archived account, deleted category, a changed
account currency — is still listed as due, with a reason. It is due; it is simply not something the
engine can resolve on anyone's behalf. Archiving an account or category does not delete the
template, and unarchiving makes generation valid again with no rewrite.

## The integrity verifier

`src/features/sync/dev/verify-sync-integrity.ts` exports `verifySyncIntegrity()`: a read-only audit
of everything the local database depends on, returning `{ ok, counts, issues }`. M8E extended it
rather than adding a second verifier — two audits of the same rows would eventually disagree about
which one is right, which is the failure this module exists to catch.

It **reports and never repairs**. A verifier that rewrote a row would be deciding on its own which
of two disagreeing records is true, and if it guessed wrong about a generated transaction it would
be inventing or erasing money.

Every issue is a code, a count and at most an entity type — no amounts, names or notes — so a report
is safe to paste into an issue. It lives under `dev/` and is deliberately not reachable from any
screen.

It complements `assertSyncFoundationReady`, which is a startup gate asking whether the schema
arrived. This asks whether the rows inside it still say consistent things about each other.

What it checks for the M8 entities (alongside the sync-side checks it already made):

| Entity                 | Checks                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budgets                | sync id present, canonical and unique; amount a positive safe integer; `YYYY-MM` month; canonical currency; category exists and is an expense category; no duplicate live logical budget, overall included                                   |
| Templates              | sync id; supported type and frequency; positive safe amount; interval in range; valid dates with `endDate >= startDate`; live templates reference an existing account and a category of the matching type                                    |
| Occurrences            | sync id; **derived** identity matching template and date; valid status; date the template is actually scheduled on; one decision per template and date; a generated occurrence produced a transaction; a skipped one has no live transaction |
| Generated transactions | the occurrence they claim exists; **derived** identity matching that occurrence; the type is an ordinary expense or income                                                                                                                   |

Three cases it is deliberately quiet about, because they are legal states the app creates on
purpose:

- A **tombstoned** budget or template referencing a category that has since gone. Deleted rows are
  history, and history keeps its references.
- A generated transaction the user **deleted**. The row still exists, tombstoned, which is what
  proves generation completed; the occurrence stays handled and is never regenerated.
- A live template on an **archived** account or a soft-deleted category. The template stays and its
  due dates are reported as blocked — that is the designed behaviour, not a fault.

`recurring_generated_without_transaction` — a generated occurrence with no transaction row at all,
not even a tombstoned one — is the partial-generation case, and it is a release blocker.

## Where the tests live

| Area                                                                 | File                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Budget arithmetic, month boundaries, restatement, currency, extremes | `test/budgets/budget-engine.test.ts`, `test/budgets/budget-hardening.test.ts`, `test/budgets/budget-transaction-effects.test.ts` |
| Calendar regressions, day 28/29/30/31, yearly Feb 29, year ends      | `test/recurring/recurring-schedule.test.ts`, `test/recurring/recurring-calendar-hardening.test.ts`                               |
| Generation, skip, pause, blocking, atomicity, batches                | `test/recurring/recurring-engine.test.ts`                                                                                        |
| Budget × recurring interaction, provenance versus transaction date   | `test/recurring/recurring-budget-interaction.test.ts`                                                                            |
| Cross-device convergence, generate-vs-skip, first link, new device   | `test/sync/recurring-sync.test.ts`, `test/sync/budget-sync.test.ts`                                                              |
| Backup round-trip, old backups, malformed backups                    | `test/backup/budget-backup.test.ts`, `test/backup/recurring-backup.test.ts`                                                      |
| The verifier itself                                                  | `test/sync/recurring-integrity.test.ts`, `test/sync/budget-sync.test.ts`                                                         |
| Cloud RLS and constraints                                            | `supabase/tests/budgets.sql`, `supabase/tests/recurring.sql`, `supabase/tests/rls-matrix.sql`                                    |
