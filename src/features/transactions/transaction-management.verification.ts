import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { NotFoundError } from '@/features/shared/errors';
import { createAccount } from '@/features/accounts/account.service';
import { createCategory } from '@/features/categories/category.service';

import { getAccountBalance } from './account-balance.service';
import { filterTransactionViews } from './transaction-list-filter';
import {
  createExpense,
  createIncome,
  deleteTransaction,
  getTransaction,
  getTransactionView,
  listTransactionViews,
  updateExpense,
} from './transaction.service';
import { transactions } from '@/db/schema/transactions';

/** Invoke in a development build after database initialization. Fixtures are removed after the checks. */
export function verifyTransactionManagement() {
  if (!__DEV__)
    throw new Error('Transaction management verification is only available in development.');

  let cashId: number | undefined;
  let bankId: number | undefined;
  let foodId: number | undefined;
  let salaryId: number | undefined;
  const transactionIds: number[] = [];
  try {
    const cash = createAccount({
      name: 'M2C verification cash',
      type: 'cash',
      openingBalanceMinor: 1_000_000,
      currency: 'NPR',
    });
    cashId = cash.id;
    const bank = createAccount({
      name: 'M2C verification bank',
      type: 'bank',
      openingBalanceMinor: 2_000_000,
      currency: 'NPR',
    });
    bankId = bank.id;
    const food = createCategory({ name: 'M2C verification food', type: 'expense' });
    foodId = food.id;
    const salary = createCategory({ name: 'M2C verification salary', type: 'income' });
    salaryId = salary.id;
    const expense = createExpense({
      amountMinor: 85_000,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: new Date('2026-09-05T00:00:00.000Z'),
      note: 'Lunch with friends',
    });
    transactionIds.push(expense.id);
    const income = createIncome({
      amountMinor: 6_500_000,
      categoryId: salary.id,
      accountId: bank.id,
      transactionDate: new Date('2026-09-01T00:00:00.000Z'),
      title: 'September salary',
    });
    transactionIds.push(income.id);

    const views = listTransactionViews().filter((item) => transactionIds.includes(item.id));
    assert(views[0]?.id === expense.id, 'Transaction views were not ordered by transaction date.');
    assert(
      views.find((item) => item.id === expense.id)?.accountName === cash.name,
      'Transaction view did not include the expense account.',
    );
    assert(
      views.find((item) => item.id === income.id)?.categoryName === salary.name,
      'Transaction view did not include the income category.',
    );
    assert(
      filterTransactionViews(views, { search: 'friends', type: 'all', date: 'all' }).length === 1,
      'Transaction note search failed.',
    );
    assert(
      filterTransactionViews(views, { search: 'cash', type: 'expense', date: 'all' }).length === 1,
      'Transaction account/type filtering failed.',
    );

    updateExpense(expense.id, { amountMinor: 120_000, accountId: bank.id });
    const updated = getTransactionView(expense.id);
    assert(
      updated.amountMinor === 120_000 && updated.accountId === bank.id,
      'Transaction edit failed.',
    );
    assert(
      getAccountBalance(cash.id) === 1_000_000,
      'Editing account did not restore the original balance.',
    );
    assert(getAccountBalance(bank.id) === 8_380_000, 'Edited transaction balance was incorrect.');

    updateExpense(expense.id, { transactionDate: new Date('2026-08-15T00:00:00.000Z') });
    const reordered = listTransactionViews().filter((item) => transactionIds.includes(item.id));
    assert(
      reordered.map((item) => item.id).join(',') === `${income.id},${expense.id}`,
      'Backdated transaction edit did not reorder the transaction list.',
    );

    deleteTransaction(expense.id);
    assert(
      getAccountBalance(bank.id) === 8_500_000,
      'Deleting an expense did not restore its balance.',
    );
    expectNotFound(() => getTransaction(expense.id));
    transactionIds.splice(transactionIds.indexOf(expense.id), 1);

    return true;
  } finally {
    for (const id of transactionIds) db.delete(transactions).where(eq(transactions.id, id)).run();
    if (cashId !== undefined) db.delete(accounts).where(eq(accounts.id, cashId)).run();
    if (bankId !== undefined) db.delete(accounts).where(eq(accounts.id, bankId)).run();
    if (foodId !== undefined) db.delete(categories).where(eq(categories.id, foodId)).run();
    if (salaryId !== undefined) db.delete(categories).where(eq(categories.id, salaryId)).run();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectNotFound(action: () => unknown) {
  try {
    action();
  } catch (error) {
    if (error instanceof NotFoundError) return;
    throw error;
  }
  throw new Error('Expected a deleted transaction to be unavailable.');
}
