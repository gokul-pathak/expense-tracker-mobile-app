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

| File                      | Holds                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `recurring-schedule.ts`   | pure calendar arithmetic: dates, clamping, occurrences, no clock, no DB |
| `recurring-identity.ts`   | the fixed namespace and the UUIDv5 derivations                          |
| `recurring.validation.ts` | what makes a template well-formed, and why one cannot generate          |
| `recurring.repository.ts` | templates, handled dates, and the atomic generate and skip writes       |
| `recurring.service.ts`    | the engine: templates, what is due, generate, skip, batch generation    |
| `recurring.errors.ts`     | conflict and validation errors with codes a screen can switch on        |
| `recurring.types.ts`      | the inputs and the read models                                          |

No UI belongs here, and nothing here runs by itself. There is no startup hook, timer, background task
or notification: a caller asks what is due as of a date and decides what to do. M8D is that caller.
