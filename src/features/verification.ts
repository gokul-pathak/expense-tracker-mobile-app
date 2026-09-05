import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { people } from '@/db/schema/people';
import { settings } from '@/db/schema/settings';
import { transactions } from '@/db/schema/transactions';
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
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';
import {
  createExpense,
  createIncome,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateExpense,
} from '@/features/transactions/transaction.service';

/**
 * Invoke manually in a development build after database initialization. All
 * created fixtures are removed before this function returns or throws.
 */
export function verifyServiceLayer() {
  if (!__DEV__) {
    throw new Error('Service verification is only available in development.');
  }

  let accountId: number | undefined;
  let m1AccountId: number | undefined;
  let secondAccountId: number | undefined;
  let categoryId: number | undefined;
  let m1CategoryId: number | undefined;
  let incomeCategoryId: number | undefined;
  let personId: number | undefined;
  const transactionIds: number[] = [];
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
    m1AccountId = account.id;
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
    m1CategoryId = category.id;
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

    const cash = createAccount({
      name: 'M2A verification cash',
      type: 'cash',
      openingBalanceMinor: 1_000_000,
      currency: 'NPR',
    });
    accountId = cash.id;
    const bank = createAccount({
      name: 'M2A verification bank',
      type: 'bank',
      openingBalanceMinor: 5_000_000,
      currency: 'NPR',
    });
    secondAccountId = bank.id;
    const food = createCategory({ name: 'M2A verification food', type: 'expense' });
    categoryId = food.id;
    const salary = createCategory({ name: 'M2A verification salary', type: 'income' });
    incomeCategoryId = salary.id;

    const expense = createExpense({
      amountMinor: 100_000,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: new Date('2026-09-05T00:00:00.000Z'),
      title: ' M2A verification expense ',
      note: ' ',
      paymentMode: 'cash',
    });
    transactionIds.push(expense.id);
    const income = createIncome({
      amountMinor: 2_000_000,
      categoryId: salary.id,
      accountId: bank.id,
      transactionDate: new Date('2026-09-05T00:00:00.000Z'),
      title: 'M2A verification income',
      paymentMode: 'qr',
    });
    transactionIds.push(income.id);
    assert(
      expense.sourceAccountId === cash.id && expense.destinationAccountId === null,
      'Expense account mapping failed.',
    );
    assert(
      income.destinationAccountId === bank.id && income.sourceAccountId === null,
      'Income account mapping failed.',
    );
    assert(
      expense.title === 'M2A verification expense' && expense.note === null,
      'Transaction text was not normalized.',
    );
    assert(getAccountBalance(cash.id) === 900_000, 'Expense did not reduce the cash balance.');
    assert(getAccountBalance(bank.id) === 7_000_000, 'Income did not increase the bank balance.');
    assert(getTotalBalance() === 7_900_000, 'Total balance was calculated incorrectly.');

    updateExpense(expense.id, { amountMinor: 150_000 });
    assert(
      getAccountBalance(cash.id) === 850_000,
      'Edited expense amount was not derived correctly.',
    );
    updateExpense(expense.id, { accountId: bank.id });
    assert(getAccountBalance(cash.id) === 1_000_000, 'Original expense account was not restored.');
    assert(getAccountBalance(bank.id) === 6_850_000, 'Updated expense account was not charged.');

    expectError(
      () =>
        createExpense({
          amountMinor: 100,
          categoryId: salary.id,
          accountId: cash.id,
          transactionDate: new Date(),
        }),
      ValidationError,
    );
    expectError(
      () =>
        createIncome({
          amountMinor: 100,
          categoryId: food.id,
          accountId: cash.id,
          transactionDate: new Date(),
        }),
      ValidationError,
    );
    for (const amountMinor of [0, -1, 1.5, Number.NaN]) {
      expectError(
        () =>
          createExpense({
            amountMinor,
            categoryId: food.id,
            accountId: cash.id,
            transactionDate: new Date(),
          }),
        ValidationError,
      );
    }
    expectError(
      () =>
        createExpense({
          amountMinor: 100,
          categoryId: food.id,
          accountId: cash.id,
          transactionDate: new Date(),
          paymentMode: 'invalid' as never,
        }),
      ValidationError,
    );

    archiveAccount(bank.id);
    assert(
      getTransaction(expense.id).id === expense.id,
      'Archived-account transaction is not readable.',
    );
    expectError(
      () =>
        createExpense({
          amountMinor: 100,
          categoryId: food.id,
          accountId: bank.id,
          transactionDate: new Date(),
        }),
      ValidationError,
    );
    unarchiveAccount(bank.id);

    const dates = [
      '2026-09-05T00:00:00.000Z',
      '2026-08-10T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    ];
    for (const [index, transactionDate] of dates.entries()) {
      const transaction = createIncome({
        amountMinor: 1,
        categoryId: salary.id,
        accountId: bank.id,
        transactionDate: new Date(transactionDate),
        title: `M2A sorting ${index}`,
      });
      transactionIds.push(transaction.id);
    }
    const sortedTitles = listTransactions()
      .filter((transaction) => transaction.title.startsWith('M2A sorting'))
      .map((transaction) => transaction.title);
    assert(
      sortedTitles.join(',') === 'M2A sorting 0,M2A sorting 2,M2A sorting 1',
      'Transactions were not ordered by financial date.',
    );

    deleteTransaction(expense.id);
    assert(
      getAccountBalance(cash.id) === 1_000_000,
      'Deleting an expense did not restore the balance.',
    );
    assert(
      getAccountBalance(bank.id) === 7_000_003,
      'Deleting an expense left an incorrect bank balance.',
    );
    deleteTransaction(income.id);
    assert(
      getAccountBalance(bank.id) === 5_000_003,
      'Deleting income did not remove its financial effect.',
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

    return { accounts: true, categories: true, people: true, settings: true, transactions: true };
  } finally {
    updateDefaultCurrency(originalSettings.defaultCurrency);
    for (const transactionId of transactionIds) {
      db.delete(transactions).where(eq(transactions.id, transactionId)).run();
    }
    if (secondAccountId !== undefined)
      db.delete(accounts).where(eq(accounts.id, secondAccountId)).run();
    if (accountId !== undefined) db.delete(accounts).where(eq(accounts.id, accountId)).run();
    if (m1AccountId !== undefined) db.delete(accounts).where(eq(accounts.id, m1AccountId)).run();
    if (incomeCategoryId !== undefined)
      db.delete(categories).where(eq(categories.id, incomeCategoryId)).run();
    if (categoryId !== undefined) db.delete(categories).where(eq(categories.id, categoryId)).run();
    if (m1CategoryId !== undefined)
      db.delete(categories).where(eq(categories.id, m1CategoryId)).run();
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
