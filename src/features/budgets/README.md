# Budgets

A budget is a spending plan for one calendar month. It is a planning record, not an accounting one:
creating one writes a single row and changes no transaction, no balance and no report.

The one thing to know before changing anything here: **what was spent is never stored.** It is a
`sum` over the month's expense transactions, computed on every read. If you find yourself wanting to
add a `spent_minor` column or update a budget when an expense changes, read
[`docs/budgets-m8a.md`](../../../docs/budgets-m8a.md) first — that document explains the six ways a
stored figure goes wrong, each of which currently needs no code at all.

| File                    | Holds                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `budget.period.ts`      | `YYYY-MM` months and the local calendar range each one covers      |
| `budget.validation.ts`  | amount, currency, category and duplicate rules                     |
| `budget.repository.ts`  | reads, writes, and the spending aggregate                          |
| `budget.service.ts`     | the engine: progress, remaining, overspending, monthly summary     |
| `budget.types.ts`       | the inputs and the read models                                     |

No UI belongs here. Budget screens are M8B.
