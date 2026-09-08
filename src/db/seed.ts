import { sql } from 'drizzle-orm';

import { createSyncId } from '@/features/sync/uuid';

import { db } from './index';
import { appMetadata, categories, settings } from './schema';
import { DEFAULT_CURRENCY } from './constants';

const SEED_VERSION_KEY = 'seed.categories.version';
const SEED_VERSION = '1';

const defaultExpenseCategories = [
  { systemKey: 'expense_food', name: 'Food', icon: 'food' },
  { systemKey: 'expense_groceries', name: 'Groceries', icon: 'groceries' },
  { systemKey: 'expense_shopping', name: 'Shopping', icon: 'shopping' },
  { systemKey: 'expense_travel', name: 'Travel', icon: 'travel' },
  { systemKey: 'expense_fuel', name: 'Fuel', icon: 'fuel' },
  { systemKey: 'expense_bills', name: 'Bills', icon: 'bills' },
  { systemKey: 'expense_health', name: 'Health', icon: 'health' },
  { systemKey: 'expense_entertainment', name: 'Entertainment', icon: 'entertainment' },
  { systemKey: 'expense_education', name: 'Education', icon: 'education' },
  { systemKey: 'expense_family', name: 'Family', icon: 'family' },
  { systemKey: 'expense_gifts', name: 'Gifts', icon: 'gifts' },
  { systemKey: 'expense_other', name: 'Other', icon: 'other' },
] as const;

const defaultIncomeCategories = [
  { systemKey: 'income_salary', name: 'Salary', icon: 'salary' },
  { systemKey: 'income_business', name: 'Business', icon: 'business' },
  { systemKey: 'income_freelance', name: 'Freelance', icon: 'freelance' },
  { systemKey: 'income_interest', name: 'Interest', icon: 'interest' },
  { systemKey: 'income_bonus', name: 'Bonus', icon: 'bonus' },
  { systemKey: 'income_investment_return', name: 'Investment Return', icon: 'investment' },
  { systemKey: 'income_other', name: 'Other', icon: 'other' },
] as const;

/**
 * Run versioned default data seeding.
 * Safe to call on every app start — will not create duplicates.
 * Must be called after migrations complete successfully.
 *
 * Seeded rows get a stable sync identity, but seeding is not a user mutation:
 * it never enqueues sync outbox work.
 */
export async function runSeed(): Promise<void> {
  const versionRow = db
    .select({ value: appMetadata.value })
    .from(appMetadata)
    .where(sql`${appMetadata.key} = ${SEED_VERSION_KEY}`)
    .get();

  if (versionRow?.value === SEED_VERSION) return;

  const now = new Date();

  db.transaction((tx) => {
    for (const cat of defaultExpenseCategories) {
      tx.insert(categories)
        .values({
          name: cat.name,
          type: 'expense',
          icon: cat.icon,
          systemKey: cat.systemKey,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
          syncId: createSyncId(),
        })
        .onConflictDoNothing({ target: categories.systemKey })
        .run();
    }

    for (const cat of defaultIncomeCategories) {
      tx.insert(categories)
        .values({
          name: cat.name,
          type: 'income',
          icon: cat.icon,
          systemKey: cat.systemKey,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
          syncId: createSyncId(),
        })
        .onConflictDoNothing({ target: categories.systemKey })
        .run();
    }

    tx.insert(settings)
      .values({
        id: 1,
        defaultCurrency: DEFAULT_CURRENCY,
        createdAt: now,
        updatedAt: now,
        syncId: createSyncId(),
      })
      .onConflictDoNothing({ target: settings.id })
      .run();

    tx.insert(appMetadata)
      .values({ key: SEED_VERSION_KEY, value: SEED_VERSION })
      .onConflictDoUpdate({
        target: appMetadata.key,
        set: { value: SEED_VERSION },
      })
      .run();
  });
}

/**
 * Re-seeds defaults after the dataset was replaced from the cloud.
 *
 * A cloud account may legitimately hold no categories and no settings row. The
 * version marker would normally suppress seeding, which would leave the device
 * unable to record an expense at all, so the marker is cleared first. Existing
 * rows are untouched: `system_key` and the settings singleton id keep seeding
 * from duplicating anything that arrived from the cloud.
 */
export async function reseedDefaultsIfMissing(): Promise<boolean> {
  const categoryCount = db.select({ id: categories.id }).from(categories).all().length;
  const settingsRow = db.select({ id: settings.id }).from(settings).get();
  if (categoryCount > 0 && settingsRow !== undefined) return false;

  db.delete(appMetadata)
    .where(sql`${appMetadata.key} = ${SEED_VERSION_KEY}`)
    .run();
  await runSeed();
  return true;
}

/**
 * Development-only: verify that the default seed produced the expected data.
 */
export function verifySeedData(): { categoriesCount: number; settingsExists: boolean } {
  if (!__DEV__) {
    throw new Error('Seed verification is only available in development.');
  }

  const cats = db.select({ id: categories.id }).from(categories).all();
  const setting = db
    .select({ id: settings.id })
    .from(settings)
    .where(sql`${settings.id} = 1`)
    .get();

  return {
    categoriesCount: cats.length,
    settingsExists: setting !== undefined,
  };
}
