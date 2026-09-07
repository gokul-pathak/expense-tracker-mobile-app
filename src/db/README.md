# Database layer

`index.ts` owns the single Expo SQLite connection and exported Drizzle instance.
Schemas live in `schema/`; generated SQL migrations and their Expo bundle manifest live in the root `drizzle/` directory.

The database is initialized on Android and iOS. Web uses a platform-specific no-op initializer because Expo SQLite web requires cross-origin isolation and is not an MVP target.

## Sync foundation

`schema/sync.ts` and `schema/sync.constants.ts` hold the local `sync_outbox` and `sync_state` tables
and the shared sync vocabulary. Every syncable domain table (`accounts`, `categories`, `people`,
`transactions`, `settings`) carries a globally unique `sync_id` and a nullable `deleted_at`
tombstone. `app_metadata` and Drizzle migration bookkeeping are local-only and never sync.

`sync-integrity.ts` runs after migrations and before seeding. It fails initialization if any
syncable row is missing its sync identity, so the app never runs on a partially migrated database.

Migration SQL must separate statements with `--> statement-breakpoint`. The Expo migrator prepares
each chunk as a single SQLite statement, so anything after the first statement in a chunk is
silently ignored. `test/support/test-database.ts` applies migrations the same way, so a migration
that would half-apply on a device fails in tests.

See `src/features/sync/README.md` for the outbox, mutation-origin, and tombstone rules.
