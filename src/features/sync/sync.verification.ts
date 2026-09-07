import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { SYNC_ENTITY_TYPES, syncOutbox, type SyncEntityType } from '@/db/schema';

import {
  countPendingSyncMutations,
  getSyncState,
  listPendingSyncMutations,
} from './sync.repository';

export type SyncFoundationReport = {
  pendingCount: number;
  pendingByEntityType: Record<SyncEntityType, number>;
  linkedUserId: string | null;
  pullCursor: number | null;
  lastSuccessfulSyncAt: Date | null;
};

/**
 * Development-only sync diagnostics.
 *
 * Reports queue shape and cloud binding, never financial records or sync IDs,
 * and is not reachable from any production screen.
 */
export function verifySyncFoundation(): SyncFoundationReport {
  if (!__DEV__) throw new Error('Sync verification is only available in development.');

  const pendingByEntityType = Object.fromEntries(
    SYNC_ENTITY_TYPES.map((entityType) => [entityType, 0]),
  ) as Record<SyncEntityType, number>;
  for (const entry of listPendingSyncMutations(1000)) {
    pendingByEntityType[entry.entityType] += 1;
  }

  const state = getSyncState();
  return {
    pendingCount: countPendingSyncMutations(),
    pendingByEntityType,
    linkedUserId: state?.linkedUserId ?? null,
    pullCursor: state?.pullCursor ?? null,
    lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null,
  };
}

/**
 * Development cleanup for the manual verification utilities.
 *
 * Those tools remove their fixtures with direct deletes rather than domain
 * mutations, so the cloud work they queued is dropped here instead of being
 * left pointing at rows that no longer exist.
 */
export function removeQueuedWorkForMissingRows(): void {
  db.delete(syncOutbox)
    .where(
      sql`(${syncOutbox.entityType} = 'account' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM accounts))
       OR (${syncOutbox.entityType} = 'category' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM categories))
       OR (${syncOutbox.entityType} = 'person' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM people))
       OR (${syncOutbox.entityType} = 'transaction' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM transactions))`,
    )
    .run();
}
