# M7C Local Sync Foundation

M7C adds the local half of cloud sync: stable global identity, a durable outbox, sync bookkeeping,
tombstones, and a remote-apply path. It adds no network code. Push, pull, realtime, conflict
resolution against remote data, background sync, and cloud linking remain out of scope.

Implementation rules live next to the code in `src/features/sync/README.md`. This document records
the decisions that refine `cloud-sync-architecture.md` (M7A) and the operational notes.

## Decisions that refine M7A

1. **Application-layer enqueue, not database triggers.** Outbox rows are written by
   `enqueueSyncMutation(writer, mutation)` inside the domain mutation's own SQLite transaction.
   Triggers cannot tell a user edit from an applied remote change, which is exactly the distinction
   sync correctness depends on.
2. **`base_server_revision` deferred to M7D.** M7A proposed it on the outbox for conditional
   writes. No push exists in M7C, so the column would always be null. M7D adds it together with the
   conditional-write endpoint that populates it.
3. **`sync_conflicts` deferred to M7E.** Nothing can detect a conflict before pull exists.
4. **Create-then-delete collapse is gated on `linked_user_id IS NULL`.** That is the only state in
   which the cloud provably cannot know a local row. Once the database is bound to a cloud account,
   a delete always queues a tombstone: a redundant tombstone is idempotent, a missing one is not.
5. **`sync_id NOT NULL` stays staged.** SQLite needs a table rebuild to add the constraint. The
   invariant is held by the backfill, by every insert path, and by the startup gate
   `assertSyncFoundationReady()`, which prevents the app running on a partially migrated database.
   The rebuild can happen in a later milestone with no behaviour change.
6. **Backup format version 2.** Sync IDs travel with a backup so restore keeps cloud identity.
   Version 1 backups still restore and receive fresh identities.

## Migration note for development databases

`drizzle/20260907120000_sync_foundation/migration.sql` must separate statements with
`--> statement-breakpoint`. The Expo migrator prepares each chunk as a single SQLite statement, so
any statement after the first in a chunk is silently skipped and the migration is still recorded as
applied.

An intermediate version of this migration lacked those separators. A development database that ran
it recorded the migration as complete while only the first `ALTER TABLE` actually executed, and the
migration will not run again. **Reset such a database** (reinstall the development build or clear
app data) so the corrected migration applies from a clean state. No released build shipped that
migration, so no user data is affected.

`test/support/test-database.ts` applies migrations the same way the device does, so this class of
defect now fails in tests.

## What deliberately did not change

- SQLite remains authoritative, and screens still read only local repositories.
- Local writes work signed out, signed in, offline, and with Supabase unconfigured. Nothing in the
  mutation path consults an auth session.
- Existing rows are backfilled with identities but are not queued for upload. Filling the outbox for
  a long-time local-only user is first-cloud-link work, which M7F owns.
- The Cloud Account screen still states that no financial data has been uploaded. No "Sync Now"
  button and no "Synced" status may appear until push and pull exist.

## Suggested M7D scope

Push only: a transactional conditional-write endpoint keyed by `sync_id` and a base server revision;
an outbox `base_server_revision` column and the migration that adds it; a durable sync lock;
ordered drain of `listPendingSyncMutations()` with `markSyncAttempt` and
`removeAcknowledgedSyncMutation`; first cloud link and the `linked_user_id` binding that push
requires. Pull, cursors, and conflict handling stay in M7E.
