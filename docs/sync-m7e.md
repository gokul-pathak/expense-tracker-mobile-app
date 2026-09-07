# M7E Pull Sync

M7E downloads cloud changes, resolves conflicts and applies them to SQLite. It adds no user
interface, no first cloud link, no initial upload, no realtime and no background scheduling. SQLite
stays authoritative and no screen reads cloud data: pull writes local rows, and the existing
repositories read them.

Implementation rules live next to the code in `src/features/sync/README.md`. This document records
the decisions that refine `cloud-sync-architecture.md` (M7A) and the operational notes.

## Prerequisite that M7C and M7D left open

M7A requires per-record knowledge of the cloud for conflict detection: a local change has to be
comparable against the revision it was written on top of. M7C deferred `base_server_revision` to
M7D, and M7D deferred it again, because push writes unconditionally and captures no revision. So
when M7E started, **no per-record remote baseline existed anywhere in the local schema.**

This is stated plainly rather than worked around, because the alternative — treating "an outbox
entry exists" as "a conflict exists" — would call every remote update a conflict and quietly break
the M7A rule. M7E adds the missing metadata instead, which is the milestone that can populate it:
pull is the only code that ever reads a server revision.

- `sync_baselines(entity_type, entity_sync_id, server_revision, deleted, applied_at)` records the
  last remote revision this device accounted for, per record. Its `deleted` flag doubles as the
  tombstone registry M7A asked for, so a delete for a record this device never had is remembered
  instead of forgotten.
- `sync_outbox.base_server_revision` snapshots that baseline when a local mutation is queued. It is
  the base a downloaded revision is compared against.
- `sync_conflicts` is the audit table M7A described, now that something can detect a conflict.

Push is unchanged. It still captures no revision, so a device's own upload comes back through the
change feed and advances that record's baseline on the next pull. The consequence is documented
under [Known limitations](#known-limitations).

## Decisions that refine M7A

1. **The row's revision decides, not the change row's.** The cursor is `sync_changes.sequence`, but
   conflict comparison uses the `server_revision` on the downloaded row. A change row can carry an
   older position for an identity, and the M7D trigger defect appends a spurious revision-1 change
   for every conflicting upsert. The row is the state being applied, so the row's revision is the
   one that means anything.
2. **A batch is applied as a prefix.** When a change cannot be trusted, everything before it is
   applied and the cursor stops there. Planning retries on the shorter prefix, so one bad record
   does not discard the good records that preceded it — and the bad record is never stepped over.
3. **Application and cursor share one SQLite transaction.** Domain rows, baselines, conflict
   records, outbox cleanup and `pull_cursor` all commit together. A crash can leave the device
   behind, never ahead.
4. **Pull applies current row state, never a diff.** The change feed says _what_ changed; the row
   says what it now is. This makes repeated application idempotent by construction and makes the
   feed's duplicate entries harmless.
5. **Local pending changes win an ordinary conflict.** M7A resolves concurrent non-delete edits by
   deterministic server order. At pull time the local change has not reached the server, so it will
   resolve later and wins. Pull does not apply the remote row, keeps the queue entry, and moves only
   its base — so the next push propagates the winner. A tombstone still beats any update, in both
   directions.
6. **Identity rebinding is reconciliation, not conflict.** A built-in category matched by
   `system_key`, and the settings singleton matched by ownership, legitimately arrive under an
   identity this device has never seen. The local row adopts the cloud identity — required, because
   the cloud enforces one built-in per `system_key` and one settings row per user — and any queued
   work is repointed at the new identity. It is written to `sync_conflicts` for the audit trail but
   is not counted as a conflict.
7. **A settings tombstone is refused.** The app has no way to delete its settings singleton, and
   applying one would leave the device with no default currency.
8. **`investment` and `investment_return` are refused.** The cloud schema permits them because M7A
   required every enum to survive; the local domain rejects them, so applying one would put a row in
   SQLite that `listTransactions()` throws on.

## Cursor

`sync.sync_changes.sequence` is a single monotonic server sequence across all five tables, so
ordering is total and no two changes share a position. Rows written in the same millisecond cannot
hide each other, which a `server_updated_at` cursor could not guarantee without a tiebreaker.

`sync_state.pull_cursor` is the highest sequence whose effect is committed locally. `null` means no
position has been established yet, which is deliberately not the same as being up to date: pull
starts from the beginning of the account's history. M7F establishes the cursor during first
reconciliation, which is also why pull refuses to run at all while `linked_user_id` is null.

Batches are bounded at `PULL_BATCH_SIZE = 100` changes and `PULL_MAX_BATCHES_PER_RUN = 20` batches,
so neither one request nor one run can be unbounded. A run continues until the feed is exhausted,
the bound is reached, or something fails.

## Conflict matrix

| Local state                           | Remote state | Outcome                                                         |
| ------------------------------------- | ------------ | --------------------------------------------------------------- |
| nothing queued                        | update       | remote applies; no conflict recorded                            |
| nothing queued                        | tombstone    | tombstone applies; no conflict recorded                         |
| queued upsert, base ≥ remote revision | update       | nothing applied; the local edit is already newer                |
| queued upsert                         | update       | `local_wins`: local row untouched, queue entry kept, base moved |
| queued upsert                         | tombstone    | `remote_delete_wins`: tombstone applies, stale upsert removed   |
| queued delete                         | update       | `local_delete_wins`: row stays deleted, tombstone still queued  |
| queued delete                         | tombstone    | `converged_delete`: tombstone applies, queue entry removed      |
| edit during the run                   | update       | `local_wins`, detail `mutation_during_pull`                     |

Every queue removal is revision-guarded, exactly as push acknowledgement is, so a newer local edit
is never acknowledged away by work planned before it existed.

## Validation

Nothing downloaded is trusted. Every row is decoded by a Zod contract that mirrors the cloud schema,
then checked for ownership against `linked_user_id` — row level security already scopes the query,
but a client with no defence of its own has none left when that assumption breaks.

Money and timestamps are `bigint` in PostgreSQL and may arrive as a JSON number or a string.
Both are accepted and both are checked with `Number.isSafeInteger`; a string must round-trip
character-for-character. `parseFloat` is never used — it would turn an unrepresentable amount into a
plausible wrong one.

Domain invariants are then re-checked in local terms: category type compatibility, transfer account
difference, account currency agreement, relation existence, and debt history. Debt is validated
across local history and the batch together, in server order, so a repayment arriving with its
principal is accepted while a batch that would overpay a debt is refused at the record that caused
it.

A refused record produces a `PullFailure`, a run status of `attention_required`, and a cursor that
stops before it. The engine never resolves a missing parent by writing a null foreign key.

## Failure policy

| Situation                             | Outcome                                               |
| ------------------------------------- | ----------------------------------------------------- |
| Supabase not configured               | `unavailable`, nothing read                           |
| Signed out, or session unusable       | `auth_required`, nothing read                         |
| Authenticated but database not linked | `not_linked`, nothing read                            |
| Signed in as a different account      | `account_mismatch`, no relink                         |
| Network failure                       | `offline`, cursor and data unchanged                  |
| RLS/authorization refusal             | `error`, no service-role fallback, cursor unchanged   |
| Undecodable or foreign-owned row      | `attention_required`, cursor stops before it          |
| Domain invariant violated             | `attention_required`, cursor stops before it          |
| Local apply throws                    | `error`, whole batch rolled back including the cursor |
| Conflicts resolved                    | `conflict`, work committed                            |

`last_successful_pull_at` records pull progress only. `last_successful_sync_at` stays null: a device
is not synchronized until push and pull are orchestrated together, which is M7F's job.

## Known limitations

- **A device's own upload can log one conflict.** Push captures no revision, so an upload returns
  through the change feed as an ordinary remote change. With no queue entry this is applied
  harmlessly. With a _newer_ local edit queued, the payloads differ and the run records a
  `local_wins` conflict before converging on the newer local edit — the outcome is correct, the log
  entry is noise. An equality check suppresses the common case where the local row and the cloud row
  already agree, which covers a crash between a successful upload and its acknowledgement. Capturing
  the revision at push time would remove the rest; that belongs with the conditional-write endpoint.
- **The commit-time mutation guard is defence in depth.** Planning and application are adjacent and
  synchronous today, so a local mutation cannot land between them in this runtime. The guard exists
  because the protection must not depend on that remaining true, and the reachable window — between
  the download and planning — is covered and tested.
- **A refused record blocks progress behind it.** That is the intended trade: advancing past a
  record the engine could not apply would lose it permanently. It surfaces as `attention_required`,
  which M7F can present.
- **A hard-deleted cloud row would stall the cursor.** The change feed would name a row the query
  cannot return. Cloud account deletion is out of scope and nothing in the app hard-deletes, so this
  is anomalous rather than expected.
- **Built-in categories still reach the cloud only through first link.** They are seeded, not user
  mutations, so nothing queues them. A device that pulls a built-in reconciles by `system_key`; a
  device that has never uploaded its own has nothing to reconcile until M7F.

## Verified externally

`supabase/tests/pull.sql` checks the pull contract against the real cloud schema with
`supabase test db`: one change per mutation, unique positions across tables, incremental reads after
a cursor, revision advancement, tombstones arriving through the feed, archive not looking like a
deletion, exact `bigint` money, and RLS isolation of both rows and the change feed from another
user. It needs Docker and the Supabase CLI, so it is deliberately outside the offline test run and
**has not been executed in this environment.**

## Suggested M7F scope

First cloud link and reconciliation: a pre-link backup, the explicit **Use Cloud Data** / **Upload
This Device** choice when both sides hold data, the initial full upload that fills the outbox for an
existing local database, establishing the initial `pull_cursor`, and setting `linked_user_id` — the
binding both engines already require. Then the Sync & Account screen, `syncNow()` orchestration
(push, pull, push again when pull kept a local winner), a real `last_successful_sync_at`, and an
"Attention Required" surface for `sync_conflicts` and refused records. Realtime, background sync and
account switching stay out.
