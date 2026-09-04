import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { people } from '@/db/schema/people';
import { settings } from '@/db/schema/settings';
import {
  archiveAccount,
  createAccount,
  getAccount,
  listActiveAccounts,
  listArchivedAccounts,
  unarchiveAccount,
  updateAccount,
} from '@/features/accounts/account.service';
import {
  createCategory,
  getCategory,
  listExpenseCategories,
  listIncomeCategories,
  updateCategory,
} from '@/features/categories/category.service';
import {
  archivePerson,
  createPerson,
  getPerson,
  listActivePeople,
  unarchivePerson,
  updatePerson,
} from '@/features/people/person.service';
import { getAppSettings, updateDefaultCurrency } from '@/features/settings/settings.service';
import { ConflictError, NotFoundError, ValidationError } from '@/features/shared/errors';

/**
 * Invoke manually in a development build after database initialization. All
 * created fixtures are removed before this function returns or throws.
 */
export function verifyServiceLayer() {
  if (!__DEV__) {
    throw new Error('Service verification is only available in development.');
  }

  let accountId: number | undefined;
  let categoryId: number | undefined;
  let personId: number | undefined;
  const originalSettings = getAppSettings();

  try {
    const expenseCategories = listExpenseCategories();
    const incomeCategories = listIncomeCategories();
    assert(expenseCategories.length === 12, 'Expected 12 seeded expense categories.');
    assert(incomeCategories.length === 7, 'Expected 7 seeded income categories.');

    const account = createAccount({
      name: 'M1C verification account',
      type: 'bank',
      openingBalanceMinor: 1250,
      currency: ' npr ',
    });
    accountId = account.id;
    assert(getAccount(account.id).currency === 'NPR', 'Account currency was not normalized.');
    assert(
      updateAccount(account.id, { name: 'Updated verification account' }).name ===
        'Updated verification account',
      'Account update failed.',
    );
    archiveAccount(account.id);
    assert(
      !listActiveAccounts().some((item) => item.id === account.id),
      'Archived account is active.',
    );
    assert(
      listArchivedAccounts().some((item) => item.id === account.id),
      'Archived account is missing.',
    );
    assert(!unarchiveAccount(account.id).isArchived, 'Account unarchive failed.');
    expectError(
      () => createAccount({ name: ' ', type: 'cash', openingBalanceMinor: 0, currency: 'NPR' }),
      ValidationError,
    );
    expectError(
      () =>
        createAccount({
          name: 'Invalid',
          type: 'invalid' as never,
          openingBalanceMinor: 0,
          currency: 'NPR',
        }),
      ValidationError,
    );
    expectError(() => getAccount(-1), NotFoundError);

    const category = createCategory({ name: 'M1C verification category', type: 'expense' });
    categoryId = category.id;
    assert(getCategory(category.id).isDefault === false, 'Custom category was marked as default.');
    assert(
      updateCategory(category.id, { name: 'Updated verification category' }).name ===
        'Updated verification category',
      'Category update failed.',
    );
    expectError(
      () => createCategory({ name: ' updated verification category ', type: 'expense' }),
      ConflictError,
    );
    expectError(
      () => createCategory({ name: 'Invalid', type: 'invalid' as never }),
      ValidationError,
    );
    const seededCategory = expenseCategories[0];
    if (!seededCategory) throw new Error('Expected a seeded expense category.');
    const originalSystemKey = seededCategory.systemKey;
    const originalIsDefault = seededCategory.isDefault;
    expectError(
      () => updateCategory(seededCategory.id, { systemKey: 'modified' } as never),
      ValidationError,
    );
    assert(
      getCategory(seededCategory.id).systemKey === originalSystemKey,
      'Category system key changed.',
    );
    expectError(
      () => updateCategory(seededCategory.id, { isDefault: false } as never),
      ValidationError,
    );
    assert(
      getCategory(seededCategory.id).isDefault === originalIsDefault,
      'Category default status changed.',
    );

    const person = createPerson({ name: ' M1C verification person ', note: ' verification note ' });
    personId = person.id;
    assert(
      getPerson(person.id).name === 'M1C verification person',
      'Person name was not normalized.',
    );
    assert(
      updatePerson(person.id, { note: 'updated note' }).note === 'updated note',
      'Person update failed.',
    );
    archivePerson(person.id);
    assert(!listActivePeople().some((item) => item.id === person.id), 'Archived person is active.');
    assert(!unarchivePerson(person.id).isArchived, 'Person unarchive failed.');
    expectError(() => createPerson({ name: ' ' }), ValidationError);

    const updatedSettings = updateDefaultCurrency(' usd ');
    assert(updatedSettings.defaultCurrency === 'USD', 'Default currency was not normalized.');
    assert(getAppSettings().defaultCurrency === 'USD', 'Default currency was not persisted.');
    assert(
      db.select({ id: settings.id }).from(settings).all().length === 1,
      'Settings row was duplicated.',
    );

    return { accounts: true, categories: true, people: true, settings: true };
  } finally {
    updateDefaultCurrency(originalSettings.defaultCurrency);
    if (accountId !== undefined) db.delete(accounts).where(eq(accounts.id, accountId)).run();
    if (categoryId !== undefined) db.delete(categories).where(eq(categories.id, categoryId)).run();
    if (personId !== undefined) db.delete(people).where(eq(people.id, personId)).run();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectError(action: () => unknown, ErrorType: new (...args: never[]) => Error) {
  try {
    action();
  } catch (error) {
    if (error instanceof ErrorType) return;
    throw error;
  }
  throw new Error(`Expected ${ErrorType.name}.`);
}
