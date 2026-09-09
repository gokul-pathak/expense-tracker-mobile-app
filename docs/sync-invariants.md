# Cloud Sync invariants

These are the properties that make synchronizing someone's financial records safe. They are not
aspirations: every one has a test that fails if it stops being true, and the test is named in the
right-hand column so a future change can find out what it broke.

Breaking one of these is a release blocker, not a bug to schedule.

## Identity

| #   | Invariant                                                                                  | Verified by                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| I1  | Every syncable row has one globally unique, stable `sync_id`.                              | `test/sync/sync-identity.test.ts`, `verifySyncIntegrity` (`missing_sync_id`, `duplicate_sync_id`) |
| I2  | An identity never changes through edit, archive, sync, restart or backup restore.          | `test/sync/sync-stress.test.ts` — "keeps an identity stable"                                      |
| I3  | A duplicate identity is refused by the database rather than merged into an existing row.   | `test/sync/sync-stress.test.ts` — "refuses a duplicate global identity"                           |
| I4  | Local integer keys never leave the device; relationships cross the boundary as identities. | `test/sync/push-mapping.test.ts`, `test/sync/boundaries.test.ts`                                  |

## Local writes

| #   | Invariant                                                                            | Verified by                                                      |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| L1  | A user mutation writes its domain row and its queue entry in one SQLite transaction. | `test/sync/atomicity.test.ts`                                    |
| L2  | A remote apply never queues cloud work.                                              | `test/sync/remote-apply.test.ts`, `test/sync/boundaries.test.ts` |
| L3  | Seeding, migration and restore are not user mutations and queue nothing.             | `test/sync/outbox.test.ts`                                       |
| L4  | Exactly one live queue entry exists per identity.                                    | `verifySyncIntegrity` (`outbox_duplicate_identity`)              |

## Upload

| #   | Invariant                                                                        | Verified by                                                                |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| U1  | A queue entry is removed only after the cloud confirmed exactly that work.       | `test/sync/push-sync.test.ts`, `test/sync/crash-recovery.test.ts`          |
| U2  | Uploading is idempotent: repeating it converges on one row.                      | `test/sync/crash-recovery.test.ts` — "never uploads the same record twice" |
| U3  | A newer local edit made mid-upload is never acknowledged away.                   | `test/sync/crash-recovery.test.ts` — mutation and deletion during upload   |
| U4  | Nothing is uploaded without a committed cloud binding for the signed-in account. | `test/sync/push-eligibility.test.ts`                                       |

## Download

| #   | Invariant                                                                                              | Verified by                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| D1  | The cursor never advances past a change that was not applied.                                          | `test/sync/pull-sync.test.ts`, `test/sync/crash-recovery.test.ts`                 |
| D2  | Rows, baselines, queue cleanup and cursor commit in one transaction.                                   | `test/sync/crash-recovery.test.ts` — "rolls the whole batch back"                 |
| D3  | Downloading is idempotent: replaying a change changes nothing further.                                 | `test/sync/sync-stress.test.ts` — "applies a repeated remote change exactly once" |
| D4  | Every downloaded row is schema-checked, ownership-checked and domain-checked before it touches SQLite. | `test/sync/pull-sync.test.ts`, `test/sync/security-audit.test.ts`                 |
| D5  | A refused record stalls the cursor rather than being skipped.                                          | `test/sync/crash-recovery.test.ts` — "never advances past a change it refused"    |
| D6  | A record owned by another account is refused even if the server returns it.                            | `test/sync/security-audit.test.ts`                                                |

## Deletion

| #   | Invariant                                                                                        | Verified by                                                                                   |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| X1  | A tombstone hides a record from every domain calculation.                                        | `test/sync/tombstone-regression.test.ts`                                                      |
| X2  | A deleted record never comes back, in any device ordering.                                       | `test/sync/multi-device.test.ts`, `test/sync/sync-orchestration.test.ts`                      |
| X3  | A delete beats a concurrent edit, in both directions.                                            | `test/sync/pull-conflicts.test.ts`                                                            |
| X4  | Downloading happens before uploading, so an offline edit cannot overwrite a published tombstone. | `test/sync/sync-orchestration.test.ts` — "does not resurrect a record another device deleted" |

## Conflicts

| #   | Invariant                                                                                         | Verified by                                                        |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| C1  | A conflict is detected from a real per-record remote baseline, never from "a queue entry exists". | `test/sync/pull-conflicts.test.ts`                                 |
| C2  | Resolution is deterministic and produces one winner.                                              | `test/sync/multi-device.test.ts` — three devices, one winner       |
| C3  | Repeated cycles converge and then change nothing: a fixed point.                                  | `test/sync/sync-stress.test.ts`, `test/sync/multi-device.test.ts`  |
| C4  | A local winner stays queued and is published by the next upload; pull never writes to the cloud.  | `test/sync/pull-conflicts.test.ts`, `test/sync/boundaries.test.ts` |

## Binding and isolation

| #   | Invariant                                                                     | Verified by                                                         |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| B1  | Signing in is not linking. Only a completed reconciliation binds a database.  | `test/sync/reconciliation.test.ts`, `test/sync/boundaries.test.ts`  |
| B2  | A failed reconciliation leaves the data unchanged and the database unlinked.  | `test/sync/crash-recovery.test.ts` — reconciliation matrix          |
| B3  | A signed-in account that differs from the linked one blocks all sync.         | `test/sync/sync-stress.test.ts`, `test/sync/reconciliation.test.ts` |
| B4  | One cloud user per local database.                                            | `test/sync/cloud-sync-presentation.test.ts`                         |
| B5  | A restored backup unlinks the device and requires an explicit reconciliation. | `test/sync/sync-orchestration.test.ts`                              |

## Financial meaning

| #   | Invariant                                                                                          | Verified by                                                      |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F1  | No derived figure is ever synchronized — balances, reports and receivables are recomputed locally. | `test/sync/new-device.test.ts`, `test/sync/multi-device.test.ts` |
| F2  | A transfer stays one transfer; debt types are never rewritten as income or expense.                | `test/sync/push-mapping.test.ts`, `test/sync/pull-sync.test.ts`  |
| F3  | Debt invariants hold across devices: repayments never exceed their principal.                      | `test/sync/pull-sync.test.ts`, `test/sync/multi-device.test.ts`  |
| F4  | Identical source records produce identical derived figures on every device.                        | `test/sync/new-device.test.ts`, `test/sync/multi-device.test.ts` |

## Budgets

| #   | Invariant                                                                                        | Verified by                                                                        |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| G1  | What was spent is never stored, transported or backed up; it is derived from expenses each time. | `test/budgets/budget-transaction-effects.test.ts`, `test/sync/budget-sync.test.ts` |
| G2  | Only `expense` counts towards a budget; income, transfers and debt records never do.             | `test/budgets/budget-transaction-effects.test.ts`                                  |
| G3  | A budget counts only expenses in its own currency. No conversion happens anywhere.               | `test/budgets/budget-engine.test.ts`                                               |
| G4  | A month is `YYYY-MM` and matched on `transactionDate`, half-open, in local time.                 | `test/budgets/budget-engine.test.ts`, `test/budgets/budget-service.test.ts`        |
| G5  | One live budget per month, currency and category — including the overall budget's null category. | `supabase/tests/budgets.sql`, `test/sync/budget-sync.test.ts`                      |
| G6  | A remote budget whose category is unknown is refused, never written with a null category.        | `test/sync/budget-sync.test.ts`                                                    |
| G7  | A budget's category always belongs to the same account.                                          | `supabase/tests/budgets.sql`                                                       |
| G8  | Two devices holding the same records derive identical budget figures.                            | `test/sync/budget-sync.test.ts`                                                    |

## Security and privacy

| #   | Invariant                                                                                       | Verified by                                                         |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| S1  | No service-role key exists anywhere in the client.                                              | `test/sync/security-audit.test.ts`                                  |
| S2  | Session material never reaches SQLite, a backup, an export or a log.                            | `test/sync/security-audit.test.ts`                                  |
| S3  | App Lock credentials are device-local and never synchronized.                                   | `test/sync/security-audit.test.ts`, `supabase/tests/integrity.sql`  |
| S4  | Row level security is enabled and forced on every cloud table; anonymous callers hold no grant. | `supabase/tests/rls-matrix.sql`                                     |
| S5  | Cross-user foreign keys are refused by the database.                                            | `supabase/tests/rls-matrix.sql`                                     |
| S6  | Durable failure metadata carries a classification code, never a payload.                        | `test/sync/security-audit.test.ts`, `test/sync/sync-stress.test.ts` |

## Product

| #   | Invariant                                                                                              | Verified by                                        |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| P1  | The app is fully usable with no account and no network.                                                | `test/financial/*`, `test/sync/boundaries.test.ts` |
| P2  | "Synced" is shown only with a real binding, an empty queue, no attention-required record and no error. | `test/sync/sync-orchestration.test.ts`             |
| P3  | The last successful sync time moves only after a complete cycle.                                       | `test/sync/sync-orchestration.test.ts`             |
| P4  | Screens read SQLite only; no cloud row reaches a render path.                                          | `test/sync/cloud-sync-presentation.test.ts`        |
| P5  | No technical code (SQLSTATE, PostgREST, JWT) is ever shown to a person.                                | `test/sync/cloud-sync-presentation.test.ts`        |
