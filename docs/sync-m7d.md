# M7D Push Sync

M7D uploads locally queued changes to Supabase. It adds no download path: Pull Sync, conflict
resolution against remote rows, realtime, background scheduling and first cloud reconciliation all
remain out of scope. SQLite stays authoritative and no screen reads cloud data.

Implementation rules live next to the code in `src/features/sync/README.md`. This document records
the decisions that refine `cloud-sync-architecture.md` (M7A) and the operational notes.

## Decisions that refine M7A

1. **Push is unconditional, keyed by identity.** M7A anticipated a transactional RPC that writes
   only if the caller's `base_server_revision` still matches. The M7B schema ships no such endpoint:
   `sync.record_change()` assigns `server_revision` itself and ignores any client value, so there is
   nothing to write conditionally against. M7D therefore performs a plain idempotent upsert and does
   not invent a conflict rule it cannot evaluate without pull. Adding the conditional endpoint is
   M7E's first task.
2. **No server revision is captured locally.** Without a conditional write there is nothing to
   compare it to, and the pull cursor is `sync_changes.sequence`, not a per-row revision. Push
   therefore requests no representation back, which also keeps cloud rows out of the device.
3. **Eligibility requires an explicit link, not a session.** Push runs only when an authenticated
   user id equals `sync_state.linked_user_id`. Being signed in is not enough: without that link,
   signing into any account would silently publish an existing local database. `linked_user_id`
   stays null until M7F, so in this milestone only tests can make a database eligible.
4. **The outbox entry gained a `revision`.** M7C coalesces a newer local mutation onto the existing
   queue row, which means a queue row's identity alone cannot tell push whether the work it uploaded
   is still the work that is queued. The revision is bumped on every coalesce, snapshotted before
   upload, and required to match at acknowledgement.
5. **Settings upserts on `user_id`.** The cloud enforces one settings row per user, so ownership is
   that row's real identity. Using `sync_id` there would make a second device's push fail on the
   unique owner constraint rather than converge.
6. **One remote statement per entity group, with per-row fallback.** A batch is sent as one upsert.
   PostgREST executes it atomically, so on a row-specific rejection nothing was written and the rows
   are retried individually to attribute the failure precisely. Connection- and session-scoped
   failures are not retried row by row.

## Failure policy

| Situation                             | Outcome                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| Supabase not configured               | `unavailable`, no queue change                                   |
| Signed out, or session unusable       | `auth_required`, no queue change                                 |
| Authenticated but database not linked | `not_linked`, no queue change                                    |
| Signed in as a different account      | `account_mismatch`, no queue change, no relink                   |
| Network failure                       | `offline`, work stays queued, attempt metadata updated           |
| RLS rejection or constraint violation | `error`, work stays queued, one attempt per run                  |
| Local row unmappable                  | `error` with `invalid_local_data`, nothing malformed is uploaded |
| Row-scoped failure in a phase         | later dependent phases are not started in that run               |

Queued work is never deleted because the cloud rejected it. The only removal path is a confirmed
remote success whose queue entry still matches what was uploaded.

## Crash and concurrency safety

A crash between a successful remote write and the local acknowledgement leaves the entry queued. The
next run repeats the same upsert, which converges on the same row, and then acknowledges. Losing a
queued change would be worse than repeating an idempotent one.

Concurrent runs are prevented by an in-process guard; a second call returns `pushing` and does
nothing. Durable correctness does not depend on that guard surviving a restart — the outbox and
identity-keyed upserts provide it.

## Not a "synced" state

`sync_state.last_successful_push_at` records push progress only. `last_successful_sync_at` stays
null because pull does not exist, and nothing in the app may present the device as synchronized.
There is no production Sync Now control: without cloud linking, no ordinary user can push.

## Verified externally

`supabase/tests/push.sql` checks the push contract against the real cloud schema with `supabase
test db`: idempotent replay, tombstone upload, archive staying an update, one settings row per user,
all seven transaction types, exact minor units, cross-user rejection, and forged ownership
rejection. It needs Docker and the Supabase CLI, so it is deliberately outside the offline test run
and **has not been executed in this environment**.

## Known schema issue for M7E

`sync.record_change()` is a `before insert or update` trigger. In an `insert ... on conflict do
update`, PostgreSQL fires the BEFORE INSERT trigger before detecting the conflict, so a conflicting
upsert appends two `sync_changes` rows: a spurious one at revision 1 and the real one. Pull reads
current row state by identity, so this is redundant work rather than incorrect data, but M7E should
move the bookkeeping to an `after` trigger or deduplicate by entity when draining the cursor.

## Suggested M7E scope

Pull Sync: the conditional-write RPC M7A specified, so push can detect a conflict instead of
overwriting; `sync_changes.sequence` as the pull cursor with crash-safe advancement; batch download,
Zod decoding and domain validation of remote rows before they touch SQLite; applying batches through
the existing `applyRemote*` path in dependency-safe order; delete-wins tombstone handling; and the
`sync_conflicts` table M7A described. First cloud link, initial full upload and the Sync & Account
UI stay in M7F.
