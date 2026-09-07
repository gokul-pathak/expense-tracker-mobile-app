import { runSeed } from '@/db/seed';
import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';

import {
  createTestDatabase,
  createTestDevice,
  useTestDevice,
  type TestDatabaseOptions,
} from './test-database';

/** Fresh migrated database with the default seed applied. */
export async function setupDatabase(options?: TestDatabaseOptions) {
  createTestDatabase(options);
  await runSeed();
}

/**
 * An additional seeded device. Its built-in categories get their own sync
 * identities, exactly as a second real installation would.
 */
export async function setupDevice(name: string, options?: TestDatabaseOptions) {
  createTestDevice(name, options);
  await runSeed();
}

export { useTestDevice as onDevice };

export function makeAccount(name = 'Cash', currency = 'NPR', openingBalanceMinor = 0) {
  return accountService.createAccount({
    name,
    type: 'cash',
    openingBalanceMinor,
    currency,
  });
}

export function makePerson(name = 'Ram') {
  return personService.createPerson({ name });
}

export function expenseCategory() {
  const category = categoryService.listExpenseCategories()[0];
  if (category === undefined) throw new Error('Seed did not create expense categories.');
  return category;
}

export function incomeCategory() {
  const category = categoryService.listIncomeCategories()[0];
  if (category === undefined) throw new Error('Seed did not create income categories.');
  return category;
}
