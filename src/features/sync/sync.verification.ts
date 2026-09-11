import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { SYNC_ENTITY_TYPES, syncOutbox, type SyncEntityType } from '@/db/schema';

import { isPullRunning } from './pull-sync.service';
import { isPushRunning } from './push-sync.service';
import { countSyncConflicts } from './sync-baseline.repository';
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
  /** Progress markers for one direction each. Neither is a "synced" state. */
  lastSuccessfulPushAt: Date | null;
  lastSuccessfulPullAt: Date | null;
  lastSyncError: string | null;
  conflictCount: number;
  attentionRequiredCount: number;
  pushRunning: boolean;
  pullRunning: boolean;
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
    lastSuccessfulPushAt: state?.lastSuccessfulPushAt ?? null,
    lastSuccessfulPullAt: state?.lastSuccessfulPullAt ?? null,
    lastSyncError: state?.lastSyncError ?? null,
    conflictCount: countSyncConflicts(),
    attentionRequiredCount: countSyncConflicts('attention_required'),
    pushRunning: isPushRunning(),
    pullRunning: isPullRunning(),
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
       OR (${syncOutbox.entityType} = 'transaction' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM transactions))
       OR (${syncOutbox.entityType} = 'budget' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM budgets))
       OR (${syncOutbox.entityType} = 'recurring_template' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM recurring_templates))
       OR (${syncOutbox.entityType} = 'recurring_occurrence' AND ${syncOutbox.entitySyncId} NOT IN (SELECT sync_id FROM recurring_occurrences))`,
    )
    .run();
}
