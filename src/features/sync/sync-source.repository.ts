import { eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '@/db';
import { accounts, categories, people, settings, transactions } from '@/db/schema';
import type { SyncEntityType } from '@/db/schema';
import type { Account } from '@/db/schema/accounts';
import type { Category } from '@/db/schema/categories';
import type { Person } from '@/db/schema/people';
import type { Setting } from '@/db/schema/settings';
import type { Transaction } from '@/db/schema/transactions';

/**
 * Sync-side reads of local domain rows.
 *
 * Unlike the domain repositories these deliberately include tombstoned rows:
 * a queued deletion still has to be uploaded, and a live transaction may
 * reference a parent that another device has since deleted. Domain screens
 * must keep using the domain repositories, which hide tombstones.
 */

export type LocalSyncEntity =
  | { entityType: 'account'; row: Account }
  | { entityType: 'category'; row: Category }
  | { entityType: 'person'; row: Person }
  | { entityType: 'settings'; row: Setting }
  | { entityType: 'transaction'; row: Transaction };

export type RelationEntityType = 'account' | 'category' | 'person';

export function readLocalEntity(
  entityType: SyncEntityType,
  syncId: string,
): LocalSyncEntity | null {
  switch (entityType) {
    case 'account': {
      const row = db.select().from(accounts).where(eq(accounts.syncId, syncId)).get();
      return row === undefined ? null : { entityType, row };
    }
    case 'category': {
      const row = db.select().from(categories).where(eq(categories.syncId, syncId)).get();
      return row === undefined ? null : { entityType, row };
    }
    case 'person': {
      const row = db.select().from(people).where(eq(people.syncId, syncId)).get();
      return row === undefined ? null : { entityType, row };
    }
    case 'settings': {
      const row = db.select().from(settings).where(eq(settings.syncId, syncId)).get();
      return row === undefined ? null : { entityType, row };
    }
    case 'transaction': {
      const row = db.select().from(transactions).where(eq(transactions.syncId, syncId)).get();
      return row === undefined ? null : { entityType, row };
    }
  }
}

/** Narrow read used when a caller already knows it needs a transaction. */
export function readLocalTransaction(syncId: string): Transaction | null {
  return db.select().from(transactions).where(eq(transactions.syncId, syncId)).get() ?? null;
}

/**
 * Resolves the local integer foreign keys of a whole push batch to global sync
 * identities in one query per table, so mapping never becomes a per-row lookup.
 */
export function readSyncIdsByLocalId(
  entityType: RelationEntityType,
  localIds: readonly number[],
): Map<number, string> {
  const resolved = new Map<number, string>();
  const unique = [...new Set(localIds)];
  if (unique.length === 0) return resolved;

  const table =
    entityType === 'account' ? accounts : entityType === 'category' ? categories : people;
  const rows = db
    .select({ id: table.id, syncId: table.syncId })
    .from(table)
    .where(inArray(table.id, unique))
    .all();

  for (const row of rows) {
    if (row.syncId !== null) resolved.set(row.id, row.syncId);
  }
  return resolved;
}

/** Development helper: confirms the local sync foundation is queryable. */
export function countSyncableRowsWithIdentity(): number {
  return [accounts, categories, people, settings, transactions].reduce(
    (total, table) =>
      total + db.select({ id: table.id }).from(table).where(isNotNull(table.syncId)).all().length,
    0,
  );
}
