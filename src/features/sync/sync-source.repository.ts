import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
import {
  accounts,
  budgets,
  categories,
  people,
  recurringOccurrences,
  recurringTemplates,
  settings,
  transactions,
} from '@/db/schema';
import type { SyncEntityType } from '@/db/schema';
import type { Account } from '@/db/schema/accounts';
import type { Budget } from '@/db/schema/budgets';
import type { Category } from '@/db/schema/categories';
import type { Person } from '@/db/schema/people';
import type { RecurringOccurrence, RecurringTemplate } from '@/db/schema/recurring';
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
  | { entityType: 'budget'; row: Budget }
  | { entityType: 'category'; row: Category }
  | { entityType: 'person'; row: Person }
  | { entityType: 'settings'; row: Setting }
  | { entityType: 'transaction'; row: Transaction }
  | { entityType: 'recurring_template'; row: RecurringTemplate }
  | { entityType: 'recurring_occurrence'; row: RecurringOccurrence };

export type RelationEntityType =
  'account' | 'category' | 'person' | 'recurring_template' | 'recurring_occurrence';

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
    case 'budget': {
      const row = db.select().from(budgets).where(eq(budgets.syncId, syncId)).get();
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
    case 'recurring_template': {
      const row = db
        .select()
        .from(recurringTemplates)
        .where(eq(recurringTemplates.syncId, syncId))
        .get();
      return row === undefined ? null : { entityType, row };
    }
    case 'recurring_occurrence': {
      const row = db
        .select()
        .from(recurringOccurrences)
        .where(eq(recurringOccurrences.syncId, syncId))
        .get();
      return row === undefined ? null : { entityType, row };
    }
  }
}

const TABLES = {
  account: accounts,
  budget: budgets,
  category: categories,
  person: people,
  settings,
  transaction: transactions,
  recurring_template: recurringTemplates,
  recurring_occurrence: recurringOccurrences,
} as const;

/**
 * Local rows for a whole pull batch, one query per entity type.
 *
 * Tombstoned rows are included: pull has to know that a record exists locally
 * even when the domain hides it, or it would insert a second copy.
 */
export function readLocalRowsBySyncIds(
  entityType: SyncEntityType,
  syncIds: readonly string[],
): Map<string, { id: number; syncId: string | null; deletedAt: Date | null }> {
  const resolved = new Map<string, { id: number; syncId: string | null; deletedAt: Date | null }>();
  const unique = [...new Set(syncIds)];
  if (unique.length === 0) return resolved;

  const table = TABLES[entityType];
  const rows = db
    .select({ id: table.id, syncId: table.syncId, deletedAt: table.deletedAt })
    .from(table)
    .where(inArray(table.syncId, unique))
    .all();
  for (const row of rows) {
    if (row.syncId !== null) resolved.set(row.syncId, row);
  }
  return resolved;
}

/** Currency of each named account, for validating a downloaded transaction. */
export function readAccountCurrenciesBySyncId(
  syncIds: readonly string[],
): Map<string, { currency: string; isArchived: boolean }> {
  const resolved = new Map<string, { currency: string; isArchived: boolean }>();
  const unique = [...new Set(syncIds)];
  if (unique.length === 0) return resolved;

  const rows = db
    .select({
      syncId: accounts.syncId,
      currency: accounts.currency,
      isArchived: accounts.isArchived,
    })
    .from(accounts)
    .where(inArray(accounts.syncId, unique))
    .all();
  for (const row of rows) {
    if (row.syncId !== null) {
      resolved.set(row.syncId, { currency: row.currency, isArchived: row.isArchived });
    }
  }
  return resolved;
}

/** Type of each named category, for validating a downloaded transaction. */
export function readCategoryTypesBySyncId(syncIds: readonly string[]): Map<string, string> {
  const resolved = new Map<string, string>();
  const unique = [...new Set(syncIds)];
  if (unique.length === 0) return resolved;

  const rows = db
    .select({ syncId: categories.syncId, type: categories.type })
    .from(categories)
    .where(inArray(categories.syncId, unique))
    .all();
  for (const row of rows) {
    if (row.syncId !== null) resolved.set(row.syncId, row.type);
  }
  return resolved;
}

/** Built-in identity lookup, so a downloaded default never duplicates a seeded one. */
export function readLocalCategoryBySystemKey(
  systemKey: string,
): { id: number; syncId: string | null } | null {
  return (
    db
      .select({ id: categories.id, syncId: categories.syncId })
      .from(categories)
      .where(eq(categories.systemKey, systemKey))
      .get() ?? null
  );
}

export function readLocalSettingsSyncId(): string | null {
  return db.select({ syncId: settings.syncId }).from(settings).get()?.syncId ?? null;
}

export type LocalDebtRow = {
  personSyncId: string;
  syncId: string;
  type: TransactionType;
  amountMinor: number;
  currency: string;
};

/**
 * Live debt history for the people a pull batch touches.
 *
 * Debt invariants are checked against local history plus the batch together: a
 * repayment that arrives alongside its principal must not be rejected merely
 * because the principal is not committed yet.
 */
export function readLocalDebtRowsForPeople(personSyncIds: readonly string[]): LocalDebtRow[] {
  const unique = [...new Set(personSyncIds)];
  if (unique.length === 0) return [];

  return db
    .select({
      personSyncId: people.syncId,
      syncId: transactions.syncId,
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
    })
    .from(transactions)
    .innerJoin(people, eq(transactions.personId, people.id))
    .where(and(isNull(transactions.deletedAt), inArray(people.syncId, unique)))
    .all()
    .flatMap((row) =>
      row.personSyncId === null || row.syncId === null
        ? []
        : [
            {
              personSyncId: row.personSyncId,
              syncId: row.syncId,
              type: row.type,
              amountMinor: row.amountMinor,
              currency: row.currency,
            },
          ],
    );
}

export type LocalSnapshot = {
  accounts: Account[];
  budgets: Budget[];
  categories: Category[];
  people: Person[];
  settings: Setting[];
  transactions: Transaction[];
  recurringTemplates: RecurringTemplate[];
  recurringOccurrences: RecurringOccurrence[];
};

/**
 * Every syncable row, read in one transaction so the tables describe one
 * logical moment.
 *
 * Tombstoned rows are included: a first upload has to carry this device's
 * deletions too, or another device would keep records this one has deleted.
 */
export function readLocalSnapshot(): LocalSnapshot {
  return db.transaction((tx) => ({
    accounts: tx.select().from(accounts).all(),
    budgets: tx.select().from(budgets).all(),
    categories: tx.select().from(categories).all(),
    people: tx.select().from(people).all(),
    settings: tx.select().from(settings).all(),
    transactions: tx.select().from(transactions).all(),
    recurringTemplates: tx.select().from(recurringTemplates).all(),
    recurringOccurrences: tx.select().from(recurringOccurrences).all(),
  }));
}

/** Narrow read used when a caller already knows it needs a transaction. */
export function readLocalTransaction(syncId: string): Transaction | null {
  return db.select().from(transactions).where(eq(transactions.syncId, syncId)).get() ?? null;
}

/** The same, for a budget. Tombstoned rows included: a deletion still uploads. */
export function readLocalBudget(syncId: string): Budget | null {
  return db.select().from(budgets).where(eq(budgets.syncId, syncId)).get() ?? null;
}

/** The same, for a recurring template. */
export function readLocalRecurringTemplate(syncId: string): RecurringTemplate | null {
  return (
    db.select().from(recurringTemplates).where(eq(recurringTemplates.syncId, syncId)).get() ?? null
  );
}

/** The same, for a recurring occurrence. */
export function readLocalRecurringOccurrence(syncId: string): RecurringOccurrence | null {
  return (
    db.select().from(recurringOccurrences).where(eq(recurringOccurrences.syncId, syncId)).get() ??
    null
  );
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

  const table = TABLES[entityType];
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
  return [
    accounts,
    budgets,
    categories,
    people,
    settings,
    transactions,
    recurringTemplates,
    recurringOccurrences,
  ].reduce(
    (total, table) =>
      total + db.select({ id: table.id }).from(table).where(isNotNull(table.syncId)).all().length,
    0,
  );
}
