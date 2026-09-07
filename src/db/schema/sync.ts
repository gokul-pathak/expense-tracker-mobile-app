import { sql } from 'drizzle-orm';
import { check, index, int, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { SYNC_OPERATIONS, type SyncEntityType, type SyncOperation } from './sync.constants';

const operationList = SYNC_OPERATIONS.map((value) => `'${value}'`).join(', ');

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
    pullCursor: int('pull_cursor'),
    lastSuccessfulSyncAt: int('last_successful_sync_at', { mode: 'timestamp_ms' }),
    // Push-only marker. A full sync timestamp needs pull, which does not exist yet.
    lastSuccessfulPushAt: int('last_successful_push_at', { mode: 'timestamp_ms' }),
    lastSyncError: text('last_sync_error'),
  },
  (t) => [check('single_sync_state_row', sql`${t.singletonId} = 1`)],
);

export type SyncOutboxEntry = typeof syncOutbox.$inferSelect;
export type SyncStateRecord = typeof syncState.$inferSelect;
