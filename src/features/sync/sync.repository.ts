import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { syncOutbox, syncState } from '@/db/schema';

import type { SyncEntityType, SyncOperation } from './sync.types';

export function listPending(limit = 100) {
  return db
    .select()
    .from(syncOutbox)
    .orderBy(asc(syncOutbox.createdAt), asc(syncOutbox.id))
    .limit(limit)
    .all();
}
export function countPending() {
  return db.select().from(syncOutbox).all().length;
}
export function getPendingForEntity(entityType: SyncEntityType, entitySyncId: string) {
  return (
    db
      .select()
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entityType, entityType), eq(syncOutbox.entitySyncId, entitySyncId)))
      .get() ?? null
  );
}
export function removeAcknowledged(id: number) {
  db.delete(syncOutbox).where(eq(syncOutbox.id, id)).run();
}
export function getSyncState() {
  return db.select().from(syncState).where(eq(syncState.singletonId, 1)).get() ?? null;
}
export function enqueueSyncMutation(
  entityType: SyncEntityType,
  entitySyncId: string,
  operation: SyncOperation,
  createdAt = new Date(),
) {
  db.insert(syncOutbox)
    .values({ entityType, entitySyncId, operation, createdAt, attemptCount: 0 })
    .onConflictDoUpdate({
      target: [syncOutbox.entityType, syncOutbox.entitySyncId],
      set: { operation, createdAt },
    })
    .run();
}
