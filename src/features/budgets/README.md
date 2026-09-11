# Budgets

A budget is a spending plan for one calendar month. It is a planning record, not an accounting one:
creating one writes a single row and changes no transaction, no balance and no report.

The one thing to know before changing anything here: **what was spent is never stored.** It is a
`sum` over the month's expense transactions, computed on every read. If you find yourself wanting to
add a `spent_minor` column or update a budget when an expense changes, read
[`docs/budgets-m8a.md`](../../../docs/budgets-m8a.md) first — that document explains the six ways a
stored figure goes wrong, each of which currently needs no code at all.

The second thing: **no screen composes a sentence about a budget.** Every string a person reads —
"6,000.00 remaining", "2,000.00 over budget", "Budget reached", the spoken row label, the percentage
— comes from `budget-presentation.ts`. The same sentence appears on the budgets screen, on Home and
in Reports, and written three times it would drift three ways. It also lives there because the test
runner collects `.ts` only, so a rule inside a component is a rule nothing can assert.

## The engine

| File                   | Holds                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `budget.period.ts`     | `YYYY-MM` months, the local range each covers, and month alignment |
| `budget.validation.ts` | amount, currency, category and duplicate rules                     |
| `budget.repository.ts` | reads, writes, and the spending aggregates                         |
| `budget.progress.ts`   | the arithmetic: remaining, overspent, percentage, status           |
| `budget.service.ts`    | the engine: one budget, and one month's summary                    |
| `budget.reporting.ts`  | budget against actual across a span of months, in two queries      |
| `budget.types.ts`      | the inputs and the read models                                     |

## The interface

| File                     | Holds                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `budget-presentation.ts` | ordering, wording, percentages, month labels, spoken labels |
| `BudgetRow.tsx`          | one category budget: chip, figures, bar, gap                |
| `OverallBudgetCard.tsx`  | the month's overall plan as a ring and its figures          |
| `MonthStepper.tsx`       | `← September 2026 →`, with both arrows spoken               |
| `BudgetForm.tsx`         | set, edit and delete a plan                                 |

The screens in `src/app/budgets/` arrange these and nothing more. They import no Drizzle and no
SQLite; a budget screen calls a service and reads what comes back. See
[`docs/budgets-m8b.md`](../../../docs/budgets-m8b.md) for what the interface promises and why.
