# M8B Budget interface

M8A answers what was planned, what was spent, what remains and what went over. M8B is the part a
person can see. It adds a budgets screen, a form, and read-only budget sections on Home and in
Reports. It adds no domain behaviour: the engine it draws is the one that shipped in M8A.

## What the interface must never do

Creating, editing or deleting a budget writes one planning row. It creates no transaction, moves no
account balance, and changes no figure in any report. `test/budgets/budget-ui.test.ts` captures the
total balance, both account balances, the month's report summary and the transaction count before
every budget write and asserts they are byte-for-byte identical afterwards — because a planning
figure that reached an accounting one would be the worst bug this feature could have, and it would
be invisible.

Spending flows the other way and needs no wiring at all. An expense added, edited, recategorised,
redated or deleted anywhere in the app changes what a budget screen shows the next time it reads,
because the screen reads a `sum` rather than a stored counter. Income, transfers, lending, borrowing
and repayments change nothing, for the same reason: only `expense` rows are summed.

## Where the words live

`src/features/budgets/budget-presentation.ts` holds every sentence and every number's formatting.
Nothing else composes one.

Two reasons. The same sentence appears in three places — the budgets screen, Home, Reports — and
written three times it drifts three ways. And the test runner collects `.ts` only, so a rule living
inside a component is a rule nothing can assert; `test/budgets/budget-presentation.test.ts` asserts
the strings a person actually reads.

The rules it encodes:

| Situation        | What is shown          | Never                 |
| ---------------- | ---------------------- | --------------------- |
| `remaining > 0`  | `6,000.00 remaining`   |                       |
| `remaining == 0` | `Budget reached`       | `Over budget`         |
| `remaining < 0`  | `2,000.00 over budget` | `−2,000.00 remaining` |
| `spent == 0`     | `No spending yet`      | any warning           |

Status is always words as well as colour. Green, amber and red carry meaning here, and a row that
can only be read in colour cannot be read by everyone, so "Over budget" and "Budget reached" are
written out and read aloud.

## Percentages

The engine's `percentage` is unrounded and uncapped, and stays that way: it is a ratio, and rounding
belongs to the display. `formatBudgetPercentage` prints at most two decimals with trailing zeros
dropped, so 19,500 of 40,000 reads `48.75%`, 17,000 of 15,000 reads `113.33%`, and 9,000 of 15,000
reads `60%` rather than `60.00%`.

**Above 100% the number is never capped.** The bar is what stops: `ProgressBar` rescales so the plan
sits at a hairline marker and the overflow renders beyond it. A bar can show how far over; the
figure beside it says exactly how far. `formatBudgetPercentageCompact` exists for the middle of the
overall ring, where there is no room for decimals and the exact figure sits beside it as text.

## Ordering

Category budgets are sorted **over budget first, then by percentage descending, then by category
name, then by id**. The final tie-break is not decoration: a list that reorders between two renders
of identical data reads as a bug, and the id is the only value guaranteed to differ when everything
else matches.

## Months

The screen opens on the current local calendar month — never on the latest month that happens to
hold a budget. Both arrows stay live: a future month is a plan waiting for its spending, and a past
month is a record worth looking at.

The screen never computes a date range. It hands a `YYYY-MM` to the service, which owns the
half-open local range that month covers. `stepPeriodMonth` moves between months through the local
`Date` constructor, so December rolls into January without a table of month lengths.

A month change and a background sync can finish in either order. The screen records which month the
newest read was started for and drops any answer that is not about the month on screen, so a pull
landing during a step cannot paint August's figures under September's name.

## Duplicates

One budget exists per month, currency and category. The form reads the chosen month's budgets, so
picking a category that is already budgeted — or "Everything" when an overall budget exists — shows
which budget already exists and a way to open it, instead of letting a save fail. The service still
refuses a duplicate, because another device can create one between the form loading and Save.

## Home

Home gets one section, from `getHomeBudgetSummary()` in `dashboard-budget.service.ts`, which
composes the budget engine's monthly summary rather than counting expenses again. Home has no second
opinion about what was spent.

That function sits beside `dashboard.service.ts` rather than inside it. Everything in the accounting
service is a record of what happened, it is reached by code that has no business loading the budget
engine, and putting a planning module in its import graph followed it everywhere — including into a
unit test that mocks repositories and had never needed `expo-sqlite`, which is how the coupling was
found.

It says **"Monthly Budget" only when an overall budget exists.** With only category budgets it says
"Budgets" and shows them. The sum of the category budgets is available and is never presented as a
monthly budget: an overall budget is a limit someone chose, and a total nobody chose is not one. The
same reasoning is why the engine never adds the two together — an overall budget already covers the
spending its category budgets cover.

With no budget at all, Home shows a single row offering to set one. Never `0 of 0`.

## Reports

Reports gains "Budget vs Actual" and changes no report figure.

A budget is monthly and stays monthly. `periodMonthsInRange` returns the whole calendar months a
report period covers, or `null` when it covers part of one. "This Month", "Last Month", "3 Months",
"6 Months" and "This Year" align; "This Week" does not, and a custom range only does when it runs
from the first of one month to the first of another. A period that does not align gets the sentence
"Budgets are tracked monthly" rather than a slice of a limit.

**Nothing is prorated.** September's 30,000 is not 7,000 for a week. A prorated figure would be a
number the user never set, printed with exactly as much authority as one they did.

Multi-month periods show one row per month and never a sum: a limit is a promise about one month,
and a total of six is not a promise anyone made. A month with no budget reads "No budget set", not
"Budget 0" — null and zero are different answers and only one of them is ever true.

## Queries

`getBudgetComparisonForMonths` reads every budget in the span in one query and every expense in the
span in another, then buckets by local calendar month in JavaScript. Two queries for one month and
two for twelve; `test/budgets/budget-reports.test.ts` asserts the two counts are equal rather than
asserting a magic number, so the invariant survives a driver change.

Bucketing in SQL was rejected. Deciding which calendar month an instant belongs to inside SQLite
would depend on the connection's time zone rather than the device's, which is the exact disagreement
`period_month` exists to prevent.

The budgets screen renders its rows through a `FlatList`, with the month stepper and the overall
card as its header. A month can hold as many category budgets as there are expense categories, and
the app puts no ceiling on those.

## Failure

A budget whose spending cannot be read is never drawn as zero spent. The screen shows an error with
a retry and says the data is safe, because a confident wrong figure about someone's money is worse
than an honest failure. Raw SQLite and Supabase messages never reach a screen — `getUserErrorMessage`
passes domain errors through and replaces everything else with a plain sentence.

Opening `budgets/<nonsense>` or a deleted budget's route is not an error: there is nothing to open,
and both show the same "This budget no longer exists" state with a way back, noting that transactions
are unaffected.

## Sync and offline

The screens know nothing about outboxes, tombstones or revisions. They call the service; the service
writes locally and queues. Offline creation, editing and deletion therefore work exactly as they do
online, appear immediately, and surface as the app's existing global "pending changes" state. There
is no budget-specific cloud UI and no budget-specific conflict dialog — M7's resolution is
deterministic, and the winner is simply what the next read returns.

## Deliberately absent

No rollover, no "repeat every month", no budget created automatically, no notification at 80% or
100%, no predicted spending, no advice, no daily or weekly budgets, no per-account budgets, and no
currency conversion. Editing a budget from Reports is absent too: Reports links to the budgets
screen, and the edit flow stays in one place.
