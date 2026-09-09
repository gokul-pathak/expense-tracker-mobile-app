# M8A Budget domain and calculation engine

A budget answers four questions: how much was planned, how much was spent, how much remains, and
what went over. M8A is the data layer that answers them. There is no budget UI — that is M8B.

## The one design decision everything follows from

**Spending is never stored.** There is no `spent_minor` column, no counter incremented when an
expense is created, nothing to keep in step. Every figure is a `sum` over the month's expense
transactions, computed by SQLite when it is asked for.

The alternative would need a correction for each of these, and one missed correction leaves a number
that is wrong in a way nothing reveals:

| The user does this                   | Budget effect                                      |
| ------------------------------------ | -------------------------------------------------- |
| Edits an expense from 2,000 to 4,000 | Spending is 4,000, not 6,000                       |
| Moves an expense from Food to Travel | Food falls, Travel rises, the month is unchanged   |
| Changes a date from Sep 5 to Aug 30  | September falls, August rises                      |
| Changes which account paid           | Nothing changes                                    |
| Deletes an expense                   | Its effect disappears everywhere                   |
| Records an expense dated last month  | Last month's budget changes, this month's does not |

None of those needed a line of code. `test/budgets/budget-transaction-effects.test.ts` exists to keep
it that way.

## What a budget is

A planning record, not an accounting one. Creating one writes a single row: no transaction, no
balance change, nothing in any report. Reports remain a record of what actually happened.

```text
budgets
  id            local integer key, never leaves the device
  sync_id       stable global identity
  category_id   null = the overall monthly budget
  period_month  'YYYY-MM'
  amount_minor  integer minor units, > 0
  currency
  created_at / updated_at / deleted_at
```

## Monthly periods

`period_month` is the text `YYYY-MM`, checked by the schema, the cloud, and the backup format
against one shared pattern in `src/db/constants.ts`.

A month is an identity, not an instant. Storing `2026-09-01T00:00+05:45` would make two devices in
different time zones disagree about which month a budget belongs to. The calendar range the identity
stands for is computed where it is used, in local time, half-open:

```text
2026-09-01 00:00 local  <=  transactionDate  <  2026-10-01 00:00 local
```

Half-open means no expense can fall in two months and none can fall between them. The range is built
with `new Date(year, monthIndex, 1)`, which gets February, leap years and year ends right without a
table of month lengths.

The match is on `transactionDate` — the date the money moved — never on `createdAt`. An expense
entered today for last month belongs to last month.

Only monthly budgets exist. Weekly, annual, daily and custom cycles are deliberately absent; the
schema would extend cleanly to a period type, but guessing at one now would be premature.

## Category and overall budgets

A budget with a category applies to that category's expenses. A budget with `category_id = null` is
the **overall monthly budget**: the plan for everything spent that month.

They are independent readings of the same spending, not parts of one another:

```text
Overall September   40,000
Food September      15,000
Travel September    10,000

A 5,000 Food expense raises Food to 5,000 and the overall figure to 5,000.
```

Category budgets are never subtracted from the overall budget, and the overall budget is never the
sum of them. A `MonthlyBudgetSummary` exposes both readings and refuses to add them:
`totalBudgetedMinor` is the overall amount when an overall budget exists, otherwise the sum of the
category budgets, and `categoryBudgetedMinor` is always that sum. `totalBudgetedMinor` is `null` when
the month has no budget at all — which is not the same as a plan of zero, and reads very differently
to anything comparing spending against it.

A category budget may reference only an expense category. A budget on an income category would
compare a limit against spending that cannot occur.

## What counts as spending

Only `type = 'expense'`. Income adds nothing to a spending plan; a transfer moves money between the
user's own accounts and spends none of it; and lending, borrowing and repayments change what is owed
rather than what was consumed.

```sql
select category_id, sum(amount_minor)
from transactions
where type = 'expense'
  and deleted_at is null
  and currency = ?
  and transaction_date >= ? and transaction_date < ?
group by category_id
```

One query answers every budget in a month. A month with a hundred budgets reads the transaction table
once, not a hundred times — measured in `test/budgets/budget-performance.test.ts`.

## Currency

**A budget counts only expenses in its own currency. There is no conversion.** An NPR budget is never
compared against a USD expense, because no rate exists in this app and inventing one would produce a
figure the user never agreed to. A month can hold budgets in more than one currency; each is a
separate plan with a separate summary.

## Duplicates

One live budget per month, currency and category. Two plans for the same thing have no meaningful
reading: neither is the plan, and their sum is a number nobody chose.

Enforced in three places:

- the service, which returns a clear message;
- SQLite, with a partial unique index over `(period_month, currency, coalesce(category_id, -1))`
  where `deleted_at is null`;
- PostgreSQL, with the same shape over `coalesce(category_sync_id, nil-uuid)`.

The `coalesce` is not decoration. In both databases every null is distinct from every other null, so
an ordinary unique index would let a month accumulate any number of overall budgets. The index is
partial so a deleted plan releases its month and the same budget can be created again.

## Progress

```ts
{
  budget, categoryName,
  spentMinor,       // integer minor units
  remainingMinor,   // amount - spent, signed: negative when overspent
  overspentMinor,   // max(0, spent - amount)
  percentage,       // spent / amount * 100, unrounded and uncapped
  status,           // 'unused' | 'within_budget' | 'at_budget' | 'over_budget'
}
```

`percentage` is a whole-number scale — 60 means 60% — and is deliberately **not** capped at 100. A
budget of 15,000 against 17,000 spent is 113.33%, and that is the true reading; a bar that stops at
100% is a presentation choice M8B can make. It is the only floating-point value here, and it is
derived from integers and never feeds back into one. Money stays integer throughout.

The four statuses are arithmetic, not advice. There is deliberately no `near_limit`: any threshold
for it would be invented, and this engine returns facts rather than opinions about how someone should
spend.

`categoryName` is read through a join, so renaming Food to Dining shows the new name without moving
the budget — the relationship is the category's identity, not its name. A budget whose category is
later deleted on another device stays readable: deleting a category is not a reason to erase what was
planned. Creating a _new_ budget for a deleted category is refused, as it is anywhere else a category
can be chosen.

## Sync

Budgets obey the M7 architecture from day one; `budget` is an ordinary sync entity type.

- **Identity** — every budget gets a `sync_id` from the existing generator at creation.
- **Outbox** — create, update and delete write the budget row and the queue entry in one SQLite
  transaction. A pending budget makes the device `pending_changes`, using the same queue and the same
  status as everything else.
- **Remote apply** — downloaded budgets are written through `applyRemoteBudget`, which never queues.
- **Ordering** — push sends budgets in the same phase as transactions, after categories; pull applies
  them in the same phase as transactions, after categories, and their tombstones before their
  parents'. A budget has a foreign key to its category in the cloud, so the parent must land first.
- **Deletion** — a tombstone. Delete-wins in both directions: a deleted plan does not come back
  because another device edited a stale copy.
- **Conflicts** — the same deterministic resolution as every other entity, and it produces one
  budget, never two.
- **First link and new devices** — budgets are in the initial upload (after categories), in the
  whole-dataset download, in the atomic replacement, and in the obsolete-row retirement that makes
  "use this device's data" a replacement rather than a merge.
- **Meaningful data** — a budget counts. Nothing seeds or infers one, so any budget is a deliberate
  decision that a "use the cloud's data" choice would destroy, and the reconciliation cases must know
  about it.

What crosses the network is the plan: month, amount, currency, and the category's global identity.
What was spent never crosses it — each device recomputes it, which is why two devices holding the
same records always agree without a derived number ever being transported.

### Cloud constraints

`sync.budgets` has an ownership-safe composite foreign key `(category_sync_id, user_id)` into
`sync.categories`, so one account's budget can never reference another account's category. The
foreign key is `MATCH SIMPLE`, so the overall budget's null category is simply unconstrained.

That the category is an _expense_ category is **not** enforced in the database: a check constraint
cannot run the subquery it would need, and a trigger doing it would be a second place for the rule to
drift from the domain. The client refuses such a budget on the way out and again on the way in.

## Backup

Backup format version **3** adds a `budgets` collection. Versions 2 and 1 remain restorable and
restore with no budgets — the truth about those files, not a reason to reject them. Each version's
schema is strict, so a file cannot claim to be older than the data it carries.

A backup stores the plan and never the progress: `spent`, `remaining` and `percentage` are absent,
because the transactions in the same file reproduce them exactly and a stored figure could only be a
way for the file to disagree with itself. Restore is not a user mutation, queues nothing, and leaves
the device requiring an explicit reconciliation — so an older file cannot silently overwrite newer
cloud budgets.

## Integrity verifier

`verifySyncIntegrity()` gained four budget codes, on top of the identity checks every syncable table
already gets:

```text
budget_invalid_amount     not a positive safe integer of minor units
budget_invalid_month      not YYYY-MM with a month in 01-12
budget_invalid_category   points at something that is not a live expense category
budget_duplicate_period   two live plans for one month, currency and category
```

It reports and never repairs. Which of two duplicate plans is the real one is a question for a
person, and an automatic "fix" is how a decision disappears without anyone making it.

## Deliberately absent

No budget UI, no notifications at 80% or 100%, no rollover of unused budget into the next month, no
automatic copy to next month, no budget inferred from past spending, no recurring transactions, no
per-account budgets, no `personId`, and no predictive or AI budgeting. M8A is the engine; M8B owns
the interface.
