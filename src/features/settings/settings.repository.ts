import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { settings } from '@/db/schema/settings';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import { requireSyncId } from '@/features/sync/uuid';

const SETTINGS_ID = 1;
const live = isNull(settings.deletedAt);

export function getSettings() {
  return (
    db
      .select()
      .from(settings)
      .where(and(live, eq(settings.id, SETTINGS_ID)))
      .get() ?? null
  );
}

/**
 * Default currency is user-global domain data and syncs.
 * App Lock, biometrics, and other device-local preferences never reach here.
 */
export function updateDefaultCurrency(currency: string, updatedAt: Date) {
  return db.transaction((tx) => {
    const record =
      tx
        .update(settings)
        .set({ defaultCurrency: currency, updatedAt })
        .where(and(live, eq(settings.id, SETTINGS_ID)))
        .returning()
        .get() ?? null;
    if (record === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'settings',
      entitySyncId: requireSyncId(record.syncId, 'settings record'),
      operation: 'upsert',
    });
    return record;
  });
}
