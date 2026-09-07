# M7A Cloud Sync Architecture

## Status and boundaries

This is an implementation-ready design for future M7 work, not a live integration. M7A does not add Supabase packages, credentials, authentication UI, network calls, local sync columns, outbox tables, or change any domain read/write path. SQLite remains the immediate and authoritative application data source:

```text
UI -> local services/repositories -> SQLite <-> future Sync Engine <-> Supabase
```

The UI must never read financial data directly from Supabase. Local-only mode remains fully supported, including offline creation, editing, transfers, lending/borrowing, dashboard, reports, App Lock, and backup/restore. Cloud sync is bidirectional, incremental, and conflict-aware; it is not a replacement for backup.

Out of scope: Realtime, OS background work, automatic production upload, Budgets, Recurring Transactions, AI, Investments UI, CRDTs, multi-profile local databases, and custom end-to-end encryption.

## Inspected local schema and identifiers

The SQLite migration history is `drizzle/20260904095006_third_titania/migration.sql` and `drizzle/20260904151616_damp_raider/migration.sql`. The current schema is:

| Table          | Primary key                            | Relevant fields                                                                                                                | Sync classification                    |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `accounts`     | `id INTEGER PRIMARY KEY AUTOINCREMENT` | name, type, opening balance minor units, currency, icon, `is_archived`, created/updated timestamps                             | Syncable domain data                   |
| `categories`   | `id INTEGER PRIMARY KEY AUTOINCREMENT` | name, income/expense type, icon, nullable unique `system_key`, `is_default`, timestamps                                        | Syncable domain data                   |
| `people`       | `id INTEGER PRIMARY KEY AUTOINCREMENT` | name, note, `is_archived`, timestamps                                                                                          | Syncable domain data                   |
| `transactions` | `id INTEGER PRIMARY KEY AUTOINCREMENT` | type, amount minor units, currency, category/account/person integer FKs, payment mode, financial date, title, note, timestamps | Syncable domain data                   |
| `settings`     | `id INTEGER PRIMARY KEY`               | seeded singleton `id = 1`, default currency, timestamps                                                                        | Syncable user-global domain preference |
| `app_metadata` | `key TEXT PRIMARY KEY`                 | `value TEXT`; currently seed-version bookkeeping                                                                               | Local-only                             |

`created_at`, `updated_at`, and `transaction_date` are SQLite integer epoch milliseconds, mapped to `Date` in Drizzle. `transaction_date` is a financial date, never a sync ordering value. No table has a global identifier today. All financial foreign keys currently use local integer IDs. Local IDs must not leave the device as cross-device references.

`app_metadata`, Drizzle migration bookkeeping, export files, local cache/runtime state, sync locks, App Lock state, PIN salt/verifier, biometric configuration, failed-attempt state, and SecureStore contents are local-only. They must never be synced. Backup currently exports only domain tables plus `seed.*` metadata and validates that security credentials are absent; future session tokens must be excluded too.

## Decisions (ADRs)

1. **SQLite remains source of truth.** Existing repositories continue to query SQLite. Sync has separate local and remote adapters.
2. **Add, do not replace, identifiers.** M7C adds a stable nullable-then-required `sync_id` UUID text column to each syncable SQLite table. Integer primary keys remain internal and unchanged. New rows generate RFC 4122 UUIDs locally with `expo-crypto` before insert.
3. **Use a durable outbox.** Every user-originated domain mutation and its outbox entry are written in one SQLite transaction. A Boolean `synced` field is insufficient and is not used.
4. **Use tombstones.** Future domain deletes set `deleted_at`, hide rows from normal queries, and enqueue an upsert/tombstone. Tombstones are retained for the first sync release. Archive is a normal domain field and is never a delete.
5. **Bind one cloud user to one local database.** The durable sync state stores `linked_user_id` as the Supabase Auth UUID. Account changes stop sync and require a deliberate reconciliation/reset flow.
6. **RLS owns cloud isolation.** Every cloud domain row has non-null `user_id`; policies compare it to `auth.uid()`. The mobile client only has the publishable/anon key, never a service-role key.
7. **Use deterministic server-order LWW initially.** A conditional server revision write detects concurrency. The later successfully resolved server mutation wins for concurrent non-delete record updates; the losing mutation is recorded locally as a conflict event. Device wall clocks are informational only, not authoritative. A concurrent tombstone always wins over an update.
8. **Security credentials stay device-local.** App Lock PIN credentials are separate from cloud authentication and never enter SQLite backups, exports, logs, crash reports, or Supabase.

## Identity and local M7C migration

M7C must make the following additive migration, with no data loss:

1. Add nullable `sync_id TEXT` and nullable `deleted_at INTEGER` to `accounts`, `categories`, `people`, `transactions`, and `settings`; add a unique index for each non-null `sync_id`.
2. In the migration transaction, select every row with a null `sync_id` and assign a locally generated UUID. The update predicate remains `sync_id IS NULL`, making restart idempotent. Existing IDs, timestamps, and relationships are not changed.
3. Verify no null or duplicate sync IDs remain. Use a later SQLite table-rebuild migration, if required by SQLite constraints, to make `sync_id` non-null. Do not block local-only users while this is staged.
4. Update all local creation services so they generate the UUID before their insert. Restore/import must preserve existing UUIDs where a post-M7C backup contains them; legacy backups receive IDs during backfill.
5. Add `sync_outbox`, `sync_state`, and `sync_conflicts` as separate local tables. No sync table is included in portable backup/export. The backup format will need a deliberate version bump in M7C, but backup remains distinct from cloud sync.

Proposed local sync tables:

```text
sync_outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, entity_sync_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  base_server_revision INTEGER, created_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT
)
unique active ordering/index: (id); lookup index: (entity_type, entity_sync_id)

sync_state(
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  linked_user_id TEXT, pull_cursor INTEGER NOT NULL DEFAULT 0,
  last_successful_sync_at INTEGER, last_sync_error TEXT
)

sync_conflicts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_sync_id TEXT,
  local_operation TEXT, remote_revision INTEGER, detected_at INTEGER, resolution TEXT
)
```

The outbox may retain multiple ordered operations initially. It can later coalesce repeated changes to the same identity, but correctness does not depend on coalescing. A create then delete that has never been acknowledged can be collapsed to no remote operation. Failed operations remain until confirmed. A crash before a cloud acknowledgement therefore preserves intent; a crash after an acknowledgement can safely retry because remote mutations are idempotent by UUID and revision.

The local persistence API must have separate internal paths: `mutateFromUser(...)` updates the domain row and outbox in one database transaction; `applyFromRemote(...)` writes validated rows, tombstones, and cursor in one database transaction without creating outbox work or touching domain `updated_at`. UI screens only invoke domain services, never a Supabase client.

## Categories and settings

Built-in categories retain `system_key` as their stable semantic identity. Each seeded category also has a `sync_id`. The cloud category table enforces a unique non-null `(user_id, system_key)` so two devices cannot make duplicate built-ins. Initial download reconciles an already-seeded local built-in category by `system_key`, not integer ID or display name, then associates the cloud `sync_id`. Custom categories use only `sync_id`; renamed categories do not duplicate.

`settings` is one syncable user-global settings record, represented remotely by a per-user row with a UUID `sync_id`. `default_currency` is LWW at record level. App Lock enablement, biometric preference, auto-lock duration, PIN verifier/salt, failed attempts, SecureStore session data, and device/runtime preferences are device-local and never settings-sync fields.

## Cloud schema contract

`supabase/migrations/20260907000000_cloud_sync.sql` is the M7B migration source of truth, not yet referenced by the mobile financial data path. It creates `accounts`, `categories`, `people`, `transactions`, `settings`, and server-generated `sync_changes` in a dedicated `sync` schema. Auth-user deletion is restrictive; cloud account deletion is out of scope.

Each domain row has global `sync_id UUID`, `user_id UUID REFERENCES auth.users`, domain fields, `created_at` and `updated_at` preserving the domain history, `deleted_at` for tombstones, `server_updated_at`, and `server_revision`. Transaction references are UUID sync IDs, never SQLite IDs. Composite foreign keys include `user_id` to prevent cross-user relationships. Domain data uses `BIGINT` for all minor monetary units and integer epoch milliseconds for financial/domain timestamps. JavaScript must validate every received or sent integer with `Number.isSafeInteger`; values outside `Number.MIN_SAFE_INTEGER..MAX_SAFE_INTEGER` are rejected even though PostgreSQL `BIGINT` can store more.

Transactions preserve every current enum exactly: `income`, `expense`, `transfer`, `lend`, `borrow`, `repayment_received`, `repayment_paid`, `investment`, and `investment_return`. No transfer becomes two rows, and debt types are never relabeled income or expense. Cloud constraints enforce positive amounts, valid enums, required ownership, and different transfer accounts. The app repeats full semantic validation because SQL alone cannot safely validate every debt sequence, category-type relation, account currency rule, or historical dependency.

No balance, dashboard/report total, category percentage, person receivable/liability, or other derived result is stored or synchronized remotely. Those are recalculated from source records in SQLite.

## Auth, ownership, and secrets

M7B will support only Email + password and Email OTP/magic link initially. App Lock protects access to this device; Supabase Auth identifies the cloud owner. A local PIN must never be reused as a Supabase password.

After a successful sign-in, persist the Supabase session using a React Native secure-storage adapter backed by `expo-secure-store` on native platforms, using Supabase's documented supported adapter at implementation time. Session refresh must be allowed while online, but an already-linked local app must open offline without a fresh network authentication. Web storage behavior requires a separate platform review and must not weaken native token handling. Tokens are never put in SQLite, backups, exports, application logs, or crash reports.

Supabase URL and a publishable/anon key may be supplied through public Expo configuration in M7B. They are client identifiers, not secrets. The service-role key must never be bundled in the mobile app, an `.env` file used by it, source control, or a client crash report.

The linked `user_id` is the stable binding, not email. On Sign Out, first drain or explicitly abandon pending sync with a warning, create a pre-sign-out local backup, then require the user to choose either: retain an explicitly unlinked local-only copy, or clear all cloud-linked domain data and sync metadata. Default the UI to clearing on shared devices. Signing in as a different user cannot reuse or merge the previous user's cloud-linked database: stop sync, back up, then clear/replace after explicit confirmation. Simultaneous cloud profiles in one database are out of scope.

## RLS and remote API

RLS is enabled and forced on every cloud table. Policies allow a user to select, insert, update, and delete only rows whose `user_id = auth.uid()`, and insert/update policies also require `WITH CHECK (user_id = auth.uid())`. `sync_changes` is select-only for its owner; its rows are populated by triggers. Future integration tests must prove user A cannot select, insert as, update, or delete user B's data. Passing RLS isolation tests is a release blocker.

The remote adapter belongs under `src/features/sync/remote/supabase-sync.repository.ts`; the local outbox/cursor adapter belongs under `src/features/sync/sync.repository.ts`; remote decoders belong under `src/features/sync/validation/`. Zod remote-row schemas must validate UUIDs, enums, nullable relationships, safe integers, timestamps, ownership, and tombstones before a row is trusted. UI form schemas are not remote schemas.

M7D should use a transactional RPC or equivalent conditional mutation endpoint rather than unconstrained last-write-wins client upserts. The request includes `sync_id`, an operation, and `base_server_revision`. It creates/upserts only if the server's current revision matches the base revision; it returns a conflict plus the current remote row otherwise. The endpoint must derive ownership from `auth.uid()` rather than trust a caller-supplied user ID. This draft intentionally does not implement that RPC.

## Push, pull, conflicts, and deletion

Future foreground `syncNow()` operates under a durable local sync lock:

1. Confirm an authenticated session and that its user UUID equals `sync_state.linked_user_id`.
2. Push ordered outbox operations. For each, submit identity, complete current local row/tombstone, and its base server revision.
3. On success, record the returned revision locally and remove only that acknowledged outbox entry. On transport failure, increment attempt/error and leave it pending; later entries are retained. On a revision conflict, fetch the remote winner/candidate, append `sync_conflicts`, resolve deterministically, and only then acknowledge or replace the operation.
4. Pull after push, then set successful status only when both outbox is empty and pull commits.

`sync_changes.sequence BIGINT` is the pull cursor. Server triggers append a change for each domain mutation. Pull asks for records with `sequence > pull_cursor` scoped by RLS, ordered by sequence. This avoids ambiguous equal `updated_at` values and does not trust device clocks. The server revision/sequence is authoritative for synchronization order; client `updated_at` is preserved domain history only. `server_updated_at` is generated by the database and is informational for diagnostics.

For a pull batch, download changes, fetch/categorize rows and tombstones, validate all rows, then apply in a single SQLite transaction in dependency-safe order: settings, accounts/categories/people, transactions, then tombstones where parent history remains valid. Debt transactions need batch-aware validation: apply their lending/borrowing principals and repayments together before checking aggregate repayment limits, so a valid repayment is not permanently rejected merely because it arrived first. Validate foreign references, transaction enum/shape, type/category compatibility, transfer account difference/currency, account/person archive rules as appropriate for history, safe amounts, and debt invariants. Only after successful local apply may `pull_cursor` advance. Any error rolls back both row changes and cursor.

Concurrent non-delete edits use record-level LWW by deterministic server resolution order, not raw `Date.now()`: the first conditional write is current; the conflicted later sync resolves as the later server mutation and wins if its local payload remains valid. Record a local conflict event for debugging/future UI. Settings and category rename conflicts follow the same rule. This is intentionally not field merging or CRDT behavior. A tombstone wins over any concurrent update; an update cannot resurrect an intentionally deleted record in the first release. `deleted_at` is sync lifecycle state, while `is_archived` remains visible domain state and syncs normally. Tombstones are kept indefinitely initially; retention/pruning requires a later all-device-safe horizon design.

Remote apply does not enqueue an outbox mutation and does not change domain `updated_at`; sync acknowledgement also does not change it. These rules prevent update loops. A remote row is untrusted even with RLS and must pass the decoder and domain validator before it modifies SQLite.

## Initial links and user-visible state

Initial cloud link always makes a M6B backup before any destructive reconciliation. If the authenticated account has no cloud data, backfill local IDs then upload the local data and establish the pull cursor. A new device starts with a fresh SQLite DB, authenticates, downloads/validates/applies cloud data to SQLite, and then all screens read SQLite. Its seeded default categories reconcile by `system_key` rather than creating cloud duplicates.

If both this device and the selected cloud account contain data, never silently merge. Require a future explicit choice after backup: **Use Cloud Data** (replace local domain data), **Upload This Device** (replace cloud through an explicit guarded flow), or cancel. Automatic merge is deferred.

Future Settings/More route: `More -> Settings -> Sync & Account`. Status derives from durable state and in-memory activity: `Local Only`, `Syncing`, `Synced`, `Offline`, `Sync Error`, or `Attention Required`. “Last synced” is informational only; `Synced` requires an empty outbox and successful pull. Initial triggers are post-login, app foreground, an online local mutation, and manual Sync Now. Realtime, aggressive polling, and background tasks are excluded.

## Tests and rollout

M7C+ unit/integration coverage must include UUID backfill idempotency, UUID generation offline, user mutation/outbox atomicity, retry/partial failure, idempotent push, create-then-delete collapse, remote decode rejection, cursor crash safety, remote apply without re-enqueue, tombstones/delete-wins, initial upload, new-device download, offline creation, conflict outcomes, account switch prevention, and session/backup token exclusion.

Two-device matrix: A creates an expense then B receives it; A edits then B receives; A deletes then B hides it; both edit offline; A deletes while B edits; both create offline; offline transfer; lend plus repayment; A archives account; B renames category. For every source-record scenario, compare account balances, dashboard, reports, receivables, and liabilities on both devices after sync.

M7B: provision Supabase schema/RLS and minimal Auth only. M7C: additive local metadata/UUID/outbox migrations and tests. M7D: push. M7E: pull, cursor, conflicts, tombstones. M7F: Sync & Account UI, first link/new-device/sign-out flows. M7G: two-device hardening, RLS integration tests, production rollout with a simple development feature flag. Sync can be disabled without affecting SQLite data, providing rollback safety.

Risks deferred for product decisions: exact destructive “replace cloud” confirmation flow, tombstone retention policy, whether users can retain local-only data at sign-out by default, and web secure session persistence. None justify weakening the one-user binding or RLS requirements.
