import { isNull } from 'drizzle-orm';

import { ensureSyncState } from '@/features/sync/sync.repository';

import { db } from './index';
import { accounts, categories, people, settings, transactions } from './schema';

const syncableTables = [
  ['accounts', accounts],
  ['categories', categories],
  ['people', people],
  ['settings', settings],
  ['transactions', transactions],
] as const;

/**
 * Startup gate for the sync foundation.
 *
 * SQLite cannot add a NOT NULL constraint to an existing column without a full
 * table rebuild, so the sync-ID backfill is staged: the column is nullable in
 * SQL and this check enforces the invariant at startup instead. If the backfill
 * did not complete, initialization fails and the app never runs on a partially
 * migrated database.
 */
export function assertSyncFoundationReady(): void {
  for (const [name, table] of syncableTables) {
    let missing;
    try {
      missing = db.select({ id: table.id }).from(table).where(isNull(table.syncId)).limit(1).get();
    } catch (error) {
      throw new Error(
        `The local sync foundation is incomplete: ${name} could not be checked for sync identities. ` +
          `Reset the development database and reinstall to re-run migrations. (${String(error)})`,
      );
    }
    if (missing !== undefined) {
      throw new Error(
        `The local sync foundation is incomplete: ${name} still contains rows without a sync identity.`,
      );
    }
  }

  try {
    ensureSyncState();
  } catch (error) {
    throw new Error(
      'The local sync foundation is incomplete: the sync tables are missing. ' +
        `Reset the development database and reinstall to re-run migrations. (${String(error)})`,
    );
  }
}
