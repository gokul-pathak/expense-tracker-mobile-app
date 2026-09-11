# Sync (M7C foundation + M7D push + M7E pull + M7F linking and UX + M7G hardening)

Local synchronization primitives, outgoing push, incoming pull, and the first-link flows and
orchestration a person actually interacts with. There is no Realtime and no OS background
scheduling. SQLite stays authoritative and the app remains fully local-first: every local write
works offline, signed out, or with Supabase unconfigured, and no screen ever reads cloud data.

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

`sync_state` is a singleton holding `linked_user_id`, `pull_cursor`, the two direction markers
`last_successful_push_at` and `last_successful_pull_at`, `last_successful_sync_at`, and a compact
`last_sync_error`. It never stores access or refresh tokens. `linked_user_id` stays `null` until
M7F: binding a local database to a cloud account does not follow from being signed in, and both
engines refuse to run without it.

`sync_baselines` holds what this device knows about each record in the cloud — the last
`server_revision` it accounted for, and whether the cloud holds a tombstone for that identity. It is
what makes conflict detection real: a queue entry says a local change is waiting, and only the
baseline says whether the cloud moved on since that change was written. Its `deleted` flag is also
the tombstone registry, so a delete for a record this device never had cannot be forgotten and later
resurrected.

`sync_conflicts` records how each conflict was resolved: identity, revisions and the winner, never
an amount, note or name.

User-facing sync status is derived, never stored. Nothing may display "Synced" until push and pull
are orchestrated together.

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

Uploads run in dependency-safe phases — parents, then recurring templates, then recurring
occurrences, then transactions, then parent tombstones — so a cloud foreign key never sees a child
before its parent. A recurring template's tombstone goes up with its upserts, because for a template
created, used and deleted between two pushes it is the only upload that tells the cloud the template
existed. See `docs/recurring-m8c.md`. `mapping/local-to-remote.ts` resolves local
integer foreign keys to global sync identities with one lookup per relation per batch; a local
integer never leaves the device, and derived figures are never uploaded at all.

An entry is removed only after the cloud confirms exactly that work. Everything else — network
failure, RLS rejection, a constraint violation, a crash before acknowledgement — leaves it queued
with compact attempt metadata. Repeating an upload is safe because upserts are keyed by identity;
losing a queued change would not be.

`last_successful_push_at` records push progress only. It is not a synced state, and no user-facing
screen may claim one until pull exists.

## Pull (M7E)

`pullRemoteChanges()` downloads cloud changes and applies them to SQLite:

```text
changes after the cursor -> decode -> resolve conflicts -> apply + advance cursor (one transaction)
```

It runs under the same cloud binding rule as push, and under the shared engine lock in
`sync-lock.ts`, so push and pull can never interleave over the same queue entries.

`sync_changes.sequence` is the cursor: one monotonic server sequence across every table, so ordering
is total and two rows written in the same millisecond cannot hide each other. Pull always applies a
row's _current_ state rather than a diff, which makes replay idempotent and makes the feed's
duplicate entries harmless. Batches are bounded, and a run continues until it is caught up.

`pull-plan.ts` decides and never writes: it decodes every row, checks ownership against the linked
user, re-checks the domain invariants the app enforces locally, resolves conflicts, and orders the
surviving writes so a child never reaches SQLite before its parent. A batch is applied as a prefix —
when a record cannot be trusted, everything before it applies and the cursor stops there. A refused
record is never stepped over, because a cursor past a record it never applied loses it forever.

`pull-sync.service.ts` commits the plan. Domain rows, baselines, conflict records, queue cleanup and
the cursor are one SQLite transaction, so a crash leaves the device behind, never ahead.

Conflicts follow M7A: a tombstone always wins over a concurrent update, in both directions, and two
ordinary edits resolve to the local one, which has not reached the server yet and so resolves later.
The local winner stays queued and propagates on the next push — pull never writes to the cloud, not
even to resolve a conflict it just decided.

## Linking and orchestration (M7F)

Authentication is not linking. `sync_state.linked_user_id` is what the engines trust, and it is
written only by `reconciliation.service.ts` when a first link completes. `pending_link_user_id`
marks a link in progress, so a run that fails leaves a resumable setup rather than a database
claiming a relationship it never finished. `reconciliation_required` marks a dataset that was
replaced underneath a link — today only by a backup restore — and blocks sync until the user chooses
again.

`data-inventory.ts` decides whether a side "has data" from the domain, not from the outbox: seeded
categories and an untouched settings row are not data, and records that predate the outbox still
are. That judgement picks one of four flows:

```text
A both empty     link
B local only     backup -> full upload -> pull to converge -> link
C cloud only     download -> validate -> atomic local replacement -> link
D both populated explicit choice, never a merge, backup either way
```

`initial-upload.service.ts` uploads the current dataset directly, because push reads the outbox and
rows that predate it have no queued work. On the "use this device" choice it also tombstones cloud
rows this device does not have, or the next pull would download the replaced data straight back.
`cloud-snapshot.service.ts` downloads and validates a whole cloud account before
`replaceLocalDataFromRemote` swaps it in inside one transaction.

While a reconciliation runs, `enqueueSyncMutation` refuses user writes — the one chokepoint every
user-originated write already passes through, and one that leaves remote apply free to work. The
shared engine lock lets reconciliation drive push and pull as nested steps while turning away any
other run.

`sync.service.ts` is what the UI calls: `syncNow()` runs push → pull → push, bounded, because a pull
that decides a local edit wins leaves that edit queued. `last_successful_sync_at` moves only when the
whole cycle succeeds with nothing left waiting, and "Synced" additionally requires a real binding, no
attention-required records and no leftover error.

`sync.provider.tsx` owns the live view and the foreground trigger: sync on app-active, throttled, and
mounted inside the App Lock gate so a locked device syncs nothing. `sync-status.ts` derives every
user-facing state from durable facts, and `sync-presentation.ts` holds the wording — no SQLSTATE,
PostgREST code or JWT message ever reaches a person.

## Hardening (M7G)

`syncNow()` downloads before it uploads. That order is not a preference: uploads are unconditional
upserts keyed by identity, so a device that edited a record offline would otherwise overwrite a
tombstone another device had published, and the deleted record would return everywhere. Pulling
first means delete-wins has already removed the stale queue entry before anything is sent. A short
read-back afterwards keeps the cursor level with this device's own uploads, so a settled device
really does no work.

`dev/verify-sync-integrity.ts` audits a local database — identities, queue, binding, cursor,
baselines, relation integrity — and returns codes and counts. It reports and never repairs, and it
is deliberately not reachable from any screen.

The invariants this feature must uphold are written down in `docs/sync-invariants.md`, each naming
the test that fails if it stops being true. `docs/cloud-sync-runbook.md` covers running local
Supabase, reading a status, and diagnosing a device that is stuck.
