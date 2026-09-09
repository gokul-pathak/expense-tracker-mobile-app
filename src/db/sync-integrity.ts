import { isNull } from 'drizzle-orm';

import { ensureSyncState } from '@/features/sync/sync.repository';

import { db } from './index';
import {
  accounts,
  categories,
  people,
  settings,
  syncBaselines,
  syncConflicts,
  syncOutbox,
  syncState,
  transactions,
} from './schema';

const syncableTables = [
  ['accounts', accounts],
  ['categories', categories],
  ['people', people],
  ['settings', settings],
  ['transactions', transactions],
] as const;

/**
 * Every table and column the local write path depends on.
 *
 * A migration that did not reach this device leaves the app looking healthy
 * until the first save, which then fails with nothing useful to show. Probing
 * them at startup turns that into one clear message at the only moment it can
 * still be acted on.
 */
const requiredSyncReads = [
  ['sync_outbox', () => db.select().from(syncOutbox).limit(1).all()],
  ['sync_state', () => db.select().from(syncState).limit(1).all()],
  ['sync_baselines', () => db.select().from(syncBaselines).limit(1).all()],
  ['sync_conflicts', () => db.select().from(syncConflicts).limit(1).all()],
] as const;

/**
 * Startup gate for the sync foundation.
 *
 * SQLite cannot add a NOT NULL constraint to an existing column without a full
 * table rebuild, so the sync-ID backfill is staged: the column is nullable in
 * SQL and this check enforces the invariant at startup instead. If the backfill
 * did not complete, or a later migration never arrived, initialization fails and
 * the app never runs on a partially migrated database.
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

  // Selecting every column proves the table exists *and* has the shape this
  // build expects, which a bare table check would miss.
  for (const [name, read] of requiredSyncReads) {
    try {
      read();
    } catch (error) {
      throw new Error(
        `The local sync foundation is incomplete: ${name} is missing or out of date. ` +
          'A migration has not been applied to this database. Clear the Metro cache and ' +
          'restart (expo start -c); if that does not help, reinstall the development build ' +
          `to re-run migrations. (${String(error)})`,
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
