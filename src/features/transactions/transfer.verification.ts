import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';
import { archiveAccount, createAccount } from '@/features/accounts/account.service';
import { createCategory } from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

import { getAccountBalance, getTotalBalance } from './account-balance.service';
import {
  createExpense,
  createIncome,
  createTransfer,
  deleteTransaction,
  getTransaction,
  updateExpense,
  updateIncome,
  updateTransfer,
} from './transaction.service';

/** Invoke in a development build after database initialization. Fixtures are removed after checks. */
export function verifyTransferEngine() {
  if (!__DEV__) throw new Error('Transfer verification is only available in development.');

  const accountIds: number[] = [];
  const categoryIds: number[] = [];
  const transactionIds: number[] = [];
  const now = new Date();
  const currentDate = new Date(now.getFullYear(), now.getMonth(), 10, 12);
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12);

  try {
    const bank = account('M4A bank', 'bank', 5_000_000, 'NPR');
    const wallet = account('M4A wallet', 'wallet', 1_000_000, 'NPR');
    const bankB = account('M4A bank B', 'bank', 700_000, 'NPR');
    const walletB = account('M4A wallet B', 'wallet', 200_000, 'NPR');
    const usd = account('M4A USD', 'bank', 0, 'USD');
    const archived = account('M4A archived', 'cash', 0, 'NPR');
    const food = createCategory({ name: 'M4A food', type: 'expense' });
    const salary = createCategory({ name: 'M4A salary', type: 'income' });
    categoryIds.push(food.id, salary.id);

    const totalBefore = getTotalBalance();
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: bank.id,
          destinationAccountId: bank.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(
      () =>
        createTransfer({
          amountMinor: 0,
          sourceAccountId: bank.id,
          destinationAccountId: wallet.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: -1,
          destinationAccountId: wallet.id,
          transactionDate: currentDate,
        }),
      NotFoundError,
    );
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: bank.id,
          destinationAccountId: -1,
          transactionDate: currentDate,
        }),
      NotFoundError,
    );
    archiveAccount(archived.id);
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: archived.id,
          destinationAccountId: wallet.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: bank.id,
          destinationAccountId: archived.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(
      () =>
        createTransfer({
          amountMinor: 1,
          sourceAccountId: bank.id,
          destinationAccountId: usd.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );

    const transfer = createTransfer({
      amountMinor: 500_000,
      sourceAccountId: bank.id,
      destinationAccountId: wallet.id,
      transactionDate: currentDate,
      note: 'Move to wallet',
    });
    transactionIds.push(transfer.id);
    assert(
      transfer.type === 'transfer' &&
        transfer.categoryId === null &&
        transfer.personId === null &&
        transfer.paymentMode === null &&
        transfer.currency === 'NPR',
      'Transfer record convention was incorrect.',
    );
    assert(getAccountBalance(bank.id) === 4_500_000, 'Transfer did not decrease source balance.');
    assert(
      getAccountBalance(wallet.id) === 1_500_000,
      'Transfer did not increase destination balance.',
    );
    assert(getTotalBalance() === totalBefore, 'Transfer changed total balance.');
    assert(
      getDashboardSummary({ now }).totalBalanceMinor === totalBefore,
      'Transfer changed dashboard total balance.',
    );
    assertMetrics(now, 0, 0, 0, 0);

    updateTransfer(transfer.id, { amountMinor: 800_000 });
    assert(
      getAccountBalance(bank.id) === 4_200_000,
      'Editing transfer amount did not update source.',
    );
    assert(
      getAccountBalance(wallet.id) === 1_800_000,
      'Editing transfer amount did not update destination.',
    );
    assert(getTotalBalance() === totalBefore, 'Editing transfer amount changed total balance.');

    updateTransfer(transfer.id, { sourceAccountId: bankB.id });
    assert(getAccountBalance(bank.id) === 5_000_000, 'Changing source did not restore old source.');
    assert(getAccountBalance(bankB.id) === -100_000, 'Changing source did not charge new source.');
    assert(getAccountBalance(wallet.id) === 1_800_000, 'Changing source changed destination.');

    updateTransfer(transfer.id, {
      destinationAccountId: walletB.id,
      transactionDate: previousDate,
    });
    assert(
      getAccountBalance(wallet.id) === 1_000_000,
      'Changing destination did not restore old destination.',
    );
    assert(
      getAccountBalance(walletB.id) === 1_000_000,
      'Changing destination did not credit new destination.',
    );
    assert(getTotalBalance() === totalBefore, 'Backdated transfer changed total balance.');
    assertMetrics(now, 0, 0, 0, 0);

    const income = createIncome({
      amountMinor: 5_000_000,
      categoryId: salary.id,
      accountId: bank.id,
      transactionDate: currentDate,
    });
    const expense = createExpense({
      amountMinor: 1_000_000,
      categoryId: food.id,
      accountId: wallet.id,
      transactionDate: currentDate,
    });
    transactionIds.push(income.id, expense.id);
    assertMetrics(now, 5_000_000, 1_000_000, 4_000_000, 1);
    expectError(() => updateExpense(transfer.id, { amountMinor: 1 }), ValidationError);
    expectError(() => updateIncome(transfer.id, { amountMinor: 1 }), ValidationError);
    expectError(() => updateTransfer(expense.id, { amountMinor: 1 }), ValidationError);

    archiveAccount(walletB.id);
    assert(
      getTransaction(transfer.id).id === transfer.id,
      'Archived-account transfer was not readable.',
    );
    deleteTransaction(transfer.id);
    transactionIds.splice(transactionIds.indexOf(transfer.id), 1);
    assert(getAccountBalance(bankB.id) === 700_000, 'Deleting transfer did not restore source.');
    assert(
      getAccountBalance(walletB.id) === 200_000,
      'Deleting transfer did not restore destination.',
    );
    assert(
      getTotalBalance() === totalBefore + 4_000_000,
      'Deleting transfer changed financial position.',
    );

    return { transfers: true };
  } finally {
    for (const id of transactionIds) db.delete(transactions).where(eq(transactions.id, id)).run();
    for (const id of categoryIds) db.delete(categories).where(eq(categories.id, id)).run();
    for (const id of accountIds) db.delete(accounts).where(eq(accounts.id, id)).run();
  }

  function account(
    name: string,
    type: 'bank' | 'wallet' | 'cash',
    openingBalanceMinor: number,
    currency: string,
  ) {
    const created = createAccount({ name, type, openingBalanceMinor, currency });
    accountIds.push(created.id);
    return created;
  }
}

function assertMetrics(
  now: Date,
  income: number,
  expense: number,
  savings: number,
  categoryCount: number,
) {
  const summary = getDashboardSummary({ now });
  assert(summary.monthlyIncomeMinor === income, 'Transfer changed monthly income.');
  assert(summary.monthlyExpenseMinor === expense, 'Transfer changed monthly expense.');
  assert(summary.monthlySavingsMinor === savings, 'Transfer changed monthly savings.');
  assert(
    summary.categorySpending.length === categoryCount,
    'Transfer appeared in category spending.',
  );
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
