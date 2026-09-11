import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { DEFAULT_CURRENCY } from '@/db/constants';
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

/**
 * Does this database, or this cloud account, actually hold anything a person
 * would be upset to lose?
 *
 * This is the question the whole first-link flow turns on, so it is answered
 * from the domain rather than from sync bookkeeping. Two mistakes are
 * specifically avoided:
 *
 * - Counting the outbox. Records created before the outbox existed have no
 *   queued work, so a long-standing local database would look empty.
 * - Counting the seeded built-in categories. Every fresh install has them, so
 *   treating them as data would make every device look populated and turn every
 *   first link into the dangerous both-populated case.
 *
 * A changed default currency counts: it is a deliberate user decision, and
 * silently replacing it is the kind of small loss that erodes trust.
 */

export type DataInventory = {
  accounts: number;
  transactions: number;
  people: number;
  /** Categories the user created. Seeded built-ins are excluded on purpose. */
  customCategories: number;
  /**
   * Budgets are always user-created — nothing seeds or infers one — so any
   * budget is a deliberate decision that would be a real loss to overwrite.
   */
  budgets: number;
  /**
   * Recurring templates are user-created plans too — nothing seeds or infers
   * one — so a device holding one has data a person would not want replaced.
   */
  recurringTemplates: number;
  settingsChanged: boolean;
  hasMeaningfulData: boolean;
};

export function emptyInventory(): DataInventory {
  return {
    accounts: 0,
    transactions: 0,
    people: 0,
    customCategories: 0,
    budgets: 0,
    recurringTemplates: 0,
    settingsChanged: false,
    hasMeaningfulData: false,
  };
}

/** Tombstoned rows are deleted data and never make a database look populated. */
export function readLocalDataInventory(): DataInventory {
  const count = (
    table:
      | typeof accounts
      | typeof transactions
      | typeof people
      | typeof budgets
      | typeof recurringTemplates,
  ) =>
    db
      .select({ total: sql<number>`count(*)` })
      .from(table)
      .where(isNull(table.deletedAt))
      .get()?.total ?? 0;

  const customCategories =
    db
      .select({ total: sql<number>`count(*)` })
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.isDefault, false)))
      .get()?.total ?? 0;

  const settingsChanged =
    db
      .select({ id: settings.id })
      .from(settings)
      .where(and(isNull(settings.deletedAt), ne(settings.defaultCurrency, DEFAULT_CURRENCY)))
      .get() !== undefined;

  return summarize({
    accounts: count(accounts),
    transactions: count(transactions),
    people: count(people),
    customCategories,
    budgets: count(budgets),
    recurringTemplates: count(recurringTemplates),
    settingsChanged,
  });
}

/** Local rows that carry a global identity, for reporting how much will upload. */
export function countLocalSyncableRows(): number {
  const tables = [
    accounts,
    budgets,
    categories,
    people,
    settings,
    transactions,
    recurringTemplates,
    recurringOccurrences,
  ] as const;
  return tables.reduce(
    (total, table) =>
      total +
      (db
        .select({ total: sql<number>`count(*)` })
        .from(table)
        .where(isNotNull(table.syncId))
        .get()?.total ?? 0),
    0,
  );
}

export type CloudInventoryCounts = {
  accounts: number;
  transactions: number;
  people: number;
  customCategories: number;
  budgets: number;
  recurringTemplates: number;
  settingsCurrency: string | null;
};

/**
 * The same judgement applied to a downloaded cloud dataset.
 *
 * A cloud account that holds only default categories and an untouched settings
 * row is the state a device leaves behind when it links and then adds nothing,
 * so it is treated as empty rather than as a dataset worth protecting.
 */
export function summarizeCloudInventory(counts: CloudInventoryCounts): DataInventory {
  return summarize({
    accounts: counts.accounts,
    transactions: counts.transactions,
    people: counts.people,
    customCategories: counts.customCategories,
    budgets: counts.budgets,
    recurringTemplates: counts.recurringTemplates,
    settingsChanged:
      counts.settingsCurrency !== null && counts.settingsCurrency !== DEFAULT_CURRENCY,
  });
}

function summarize(counts: Omit<DataInventory, 'hasMeaningfulData'>): DataInventory {
  return {
    ...counts,
    hasMeaningfulData:
      counts.accounts > 0 ||
      counts.transactions > 0 ||
      counts.people > 0 ||
      counts.customCategories > 0 ||
      counts.budgets > 0 ||
      counts.recurringTemplates > 0 ||
      counts.settingsChanged,
  };
}
