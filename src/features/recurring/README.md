# Recurring transactions

A template is a plan to record the same expense or income on a schedule. It is not a transaction and
moves no money: no balance, report or budget reads it. Only a generated occurrence counts, and what
it produces is an ordinary expense or income, built by `transaction.service` under the same rules a
hand-entered one meets.

The one thing to know before changing anything here: **what is due is never stored.** It is the
template's schedule minus the occurrences table, derived on every read. Only decisions — a date was
generated, or a date was skipped — have rows. Read [`docs/recurring-m8c.md`](../../../docs/recurring-m8c.md)
before adding a `next_due_date` column or generating anything ahead of time.

The second thing: **occurrence and generated-transaction identities are derived, not random.** Two
offline devices generating the same date must produce the same identities, or the rent is recorded
twice. `recurring-identity.ts` and its namespace are part of the data format; never change either.

| File                        | Holds                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `recurring-schedule.ts`     | pure calendar arithmetic: dates, clamping, occurrences, no clock, no DB   |
| `recurring-identity.ts`     | the fixed namespace and the UUIDv5 derivations                            |
| `recurring.validation.ts`   | what makes a template well-formed, and why one cannot generate            |
| `recurring.repository.ts`   | templates, handled dates, history, and the atomic generate and skip writes |
| `recurring.service.ts`      | the engine: templates, what is due, generate, skip, batch, home/history reads |
| `recurring.errors.ts`       | conflict and validation errors with codes a screen can switch on          |
| `recurring.types.ts`        | the inputs and the read models                                            |
| `recurring-presentation.ts` | how a template and its due dates read: every string a screen shows        |
| `RecurringForm.tsx`         | the add / edit form (M8D)                                                 |
| `RecurringTemplateRow.tsx`  | a template as the list shows it (M8D)                                     |
| `DueOccurrenceRow.tsx`      | one due date with its generate / skip actions (M8D)                       |
| `IntervalStepper.tsx`       | the "every N units" control (M8D)                                         |

The engine still runs only when asked: no startup hook, timer, background task or notification. M8D
(the screens under `src/app/recurring/`) is the caller — a person asks what is due and generates or
skips it deliberately. UI co-located here is presentation and components only; every string a screen
shows lives in `recurring-presentation.ts` so it is testable (the runner collects only `.ts`), and
screens reach the engine through the `@/features/ui/data` facade, never the repository or `@/db`.
