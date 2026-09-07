import { sql } from 'drizzle-orm';
import { check, index, int, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import {
  SYNC_CONFLICT_RESOLUTIONS,
  SYNC_OPERATIONS,
  type SyncConflictResolution,
  type SyncEntityType,
  type SyncOperation,
} from './sync.constants';

const operationList = SYNC_OPERATIONS.map((value) => `'${value}'`).join(', ');
const resolutionList = SYNC_CONFLICT_RESOLUTIONS.map((value) => `'${value}'`).join(', ');

/**
 * Durable local queue of user-originated mutations awaiting a future cloud push.
 * It stores identity and intent only — never a copy of the financial record.
 */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    entityType: text('entity_type').notNull().$type<SyncEntityType>(),
    entitySyncId: text('entity_sync_id').notNull(),
    operation: text('operation').notNull().$type<SyncOperation>(),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Bumped every time a newer local mutation coalesces onto this entry.
     * Push snapshots it and acknowledges only the exact work it uploaded, so a
     * user edit made mid-push can never be acknowledged away.
     */
    revision: int('revision').notNull().default(1),
    /**
     * The remote revision this local mutation was written on top of, snapshotted
     * from `sync_baselines` when the mutation was queued. Pull compares it with
     * the revision it downloads: a higher remote revision means the record moved
     * on both sides, which is the only true conflict. Null means the cloud has
     * never been observed to hold this record.
     */
    baseServerRevision: int('base_server_revision'),
    attemptCount: int('attempt_count').notNull().default(0),
    lastAttemptAt: int('last_attempt_at', { mode: 'timestamp_ms' }),
    // Compact technical failure code only. Never a remote response body.
    lastError: text('last_error'),
  },
  (t) => [
    unique('uq_sync_outbox_entity').on(t.entityType, t.entitySyncId),
    check('valid_sync_operation', sql`\`operation\` IN (${sql.raw(operationList)})`),
    index('idx_sync_outbox_order').on(t.createdAt, t.id),
  ],
);

/** Singleton durable sync bookkeeping. Never stores auth tokens or PIN material. */
export const syncState = sqliteTable(
  'sync_state',
  {
    singletonId: int('singleton_id').primaryKey(),
    linkedUserId: text('linked_user_id'),
    /**
     * Highest `sync.sync_changes.sequence` whose effect is committed locally.
     * Null means no incremental position has been established yet, which is not
     * the same as being up to date.
     */
    pullCursor: int('pull_cursor'),
    lastSuccessfulSyncAt: int('last_successful_sync_at', { mode: 'timestamp_ms' }),
    // Push-only marker. A full sync timestamp needs pull, which does not exist yet.
    lastSuccessfulPushAt: int('last_successful_push_at', { mode: 'timestamp_ms' }),
    // Pull-only marker. A full sync marker needs push and pull orchestration.
    lastSuccessfulPullAt: int('last_successful_pull_at', { mode: 'timestamp_ms' }),
    lastSyncError: text('last_sync_error'),
  },
  (t) => [check('single_sync_state_row', sql`${t.singletonId} = 1`)],
);

/**
 * Per-record knowledge of the cloud: the last remote revision this device
 * applied or observed for one global identity, and whether the cloud holds a
 * tombstone for it.
 *
 * This is the baseline conflict detection needs. A pending outbox entry alone
 * only says a local change is waiting; it cannot say whether the cloud moved on
 * since that change was made. The `deleted` flag doubles as a tombstone
 * registry, so a delete that arrives for a row this device never had cannot be
 * silently forgotten and later resurrected.
 */
export const syncBaselines = sqliteTable(
  'sync_baselines',
  {
    entityType: text('entity_type').notNull().$type<SyncEntityType>(),
    entitySyncId: text('entity_sync_id').notNull(),
    serverRevision: int('server_revision').notNull(),
    deleted: int('deleted', { mode: 'boolean' }).notNull().default(false),
    appliedAt: int('applied_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entitySyncId] })],
);

/**
 * Deterministic record of every conflict Pull Sync resolved. Technical metadata
 * only: identity, revisions and the winner. Never an amount, note or name.
 */
export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    entityType: text('entity_type').notNull().$type<SyncEntityType>(),
    entitySyncId: text('entity_sync_id').notNull(),
    localOperation: text('local_operation').$type<SyncOperation>(),
    baseServerRevision: int('base_server_revision'),
    remoteServerRevision: int('remote_server_revision').notNull(),
    resolution: text('resolution').notNull().$type<SyncConflictResolution>(),
    /** Compact technical reason code. Never a financial value. */
    detail: text('detail'),
    detectedAt: int('detected_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('valid_conflict_resolution', sql`\`resolution\` IN (${sql.raw(resolutionList)})`),
    index('idx_sync_conflicts_entity').on(t.entityType, t.entitySyncId),
  ],
);

export type SyncOutboxEntry = typeof syncOutbox.$inferSelect;
export type SyncStateRecord = typeof syncState.$inferSelect;
export type SyncBaselineRecord = typeof syncBaselines.$inferSelect;
export type SyncConflictRecord = typeof syncConflicts.$inferSelect;
