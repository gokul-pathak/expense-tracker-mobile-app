# Sync (M7C foundation + M7D push)

Local synchronization primitives and outgoing push. There is no Pull Sync, no Realtime and no
background scheduling. SQLite stays authoritative and the app remains fully local-first: every
local write works offline, signed out, or with Supabase unconfigured, and no screen ever reads
cloud data.

## Identity

`uuid.ts` is the single generator of global identity (`createSyncId`), backed by the platform CSPRNG
through `expo-crypto`. Feature modules must never mint their own identifiers. Local integer primary
keys are unchanged and remain the internal relationship key; `sync_id` is the cross-device identity.

The `sync_id` column is nullable in SQL because SQLite cannot add `NOT NULL` to an existing column
without a table rebuild. The invariant is enforced instead by the migration backfill, by every
insert path, and by `assertSyncFoundationReady()`, which blocks startup if any row lacks one.

## Mutation origin

Origin is expressed by which function you call, not by a global flag:

| Origin      | Entry point                                   | Queues cloud work |
| ----------- | --------------------------------------------- | ----------------- |
| `local`     | domain repositories (`createAccount`, …)      | yes               |
| `remote`    | `remote-apply.repository.ts` (`applyRemote*`) | no                |
| `migration` | migration SQL, `seed.ts`, `restoreBackup`     | no                |

Push is a fourth kind of write and queues nothing either: it uploads and then removes queue
entries, and never writes a domain value.

A remote apply that queued an upload would push the same record straight back, so the remote path
has no access to `enqueueSyncMutation` at all. A later local edit of a remotely applied record does
queue normally.

## Outbox

`sync_outbox` stores intent, never a copy of a financial record: entity type, entity sync ID, and
operation (`upsert` or `delete`). Push will read the current local row when it runs. Vocabulary is
centralized in `src/db/schema/sync.constants.ts`.

Every user mutation writes its domain row and its outbox row in one SQLite transaction. If either
half fails, neither is committed.

Each entry carries a `revision`, bumped whenever a newer local mutation coalesces onto it. Push
snapshots the revision before uploading and removes the entry only if it still matches, so an edit
made while a push is in flight is never acknowledged away.

Coalescing keeps one pending logical operation per `(entity_type, entity_sync_id)`:

- `upsert` then `upsert` — one `upsert`, keeping the original queue position so a later edit cannot
  reorder a record ahead of the rows it depends on.
- `upsert` then `delete` — the pending entry is dropped entirely while `sync_state.linked_user_id`
  is `null`, because a database that has never been bound to a cloud account provably has never
  uploaded anything, so no tombstone is needed. Once linked, a tombstone is queued instead: an
  unnecessary delete is idempotent and harmless, a missing one is not.
- `delete` then `upsert` — the tombstone stands. A tombstoned row is invisible to the domain, so
  this cannot arise from a local edit.

Queue order is `created_at ASC, id ASC`. Financial dates are never used for ordering: a backdated
record is valid input, not an ordering signal.

## Tombstones

Deleting a transaction sets `deleted_at` and queues a `delete`. Tombstoned rows are excluded from
every domain query and every derived figure — lists, detail, search, balances, dashboard, reports,
and people receivable/liability totals — so a deleted transaction behaves exactly as it did before
tombstones existed. Sync repositories may still read them; domain repositories never do.

Archiving is not deletion. An archived account or person still exists, keeps its history, and syncs
as a normal `upsert`. `deleted_at` exists on accounts, categories, people, and settings for remote
tombstones, but the app exposes no destructive delete for them.

## Sync state

`sync_state` is a singleton holding `linked_user_id`, `pull_cursor`, `last_successful_sync_at`, and
a compact `last_sync_error`. It never stores access or refresh tokens. In M7C `linked_user_id` stays
`null`: binding a local database to a cloud account is M7F's job and does not follow from being
signed in. `pull_cursor` is storage for M7E and is unused.

User-facing sync status is derived, never stored. Nothing may display "Synced" until push and pull
exist.

## Backup

Backup format version 2 carries `syncId` so restoring keeps cloud identity. Version 1 backups
restore fine and receive fresh stable identities. Outbox rows, the pull cursor, attempt counters and
any session material are never part of a backup. Restore replaces the local dataset, so it clears
the queue and resets the cursor: restored data waits for the explicit cloud reconciliation M7F adds.

## Push (M7D)

`pushPendingChanges()` drains the outbox into Supabase:

```text
pending entry -> current local row -> map -> validate -> cloud upsert -> acknowledge
```

It runs only when an authenticated user id equals `sync_state.linked_user_id`. Signing in is not
enough: without that link, signing into any account would publish an existing local database.
Linking is M7F's job, so in this milestone only tests make a database eligible.

`remote/supabase-sync.repository.ts` is the only module that speaks to the cloud, always through the
user's own session so row level security applies. There is no service-role path. A deletion is an
upsert carrying `deleted_at`, so tombstones stay visible to other devices; archiving is an ordinary
update and never becomes a cloud deletion.

Uploads run in dependency-safe phases — parents, then transactions, then parent tombstones — so a
cloud foreign key never sees a child before its parent. `mapping/local-to-remote.ts` resolves local
integer foreign keys to global sync identities with one lookup per relation per batch; a local
integer never leaves the device, and derived figures are never uploaded at all.

An entry is removed only after the cloud confirms exactly that work. Everything else — network
failure, RLS rejection, a constraint violation, a crash before acknowledgement — leaves it queued
with compact attempt metadata. Repeating an upload is safe because upserts are keyed by identity;
losing a queued change would not be.

`last_successful_push_at` records push progress only. It is not a synced state, and no user-facing
screen may claim one until pull exists.
