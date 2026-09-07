import { int, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    entityType: text('entity_type').notNull(),
    entitySyncId: text('entity_sync_id').notNull(),
    operation: text('operation').notNull(),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    attemptCount: int('attempt_count').notNull(),
    lastError: text('last_error'),
  },
  (t) => [unique().on(t.entityType, t.entitySyncId)],
);
export const syncState = sqliteTable('sync_state', {
  singletonId: int('singleton_id').primaryKey(),
  linkedUserId: text('linked_user_id'),
  pullCursor: int('pull_cursor'),
  lastSuccessfulSyncAt: int('last_successful_sync_at', { mode: 'timestamp_ms' }),
  lastSyncError: text('last_sync_error'),
});
