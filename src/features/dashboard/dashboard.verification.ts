import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';
import {
  createAccount,
  archiveAccount,
  unarchiveAccount,
} from '@/features/accounts/account.service';
import { createCategory } from '@/features/categories/category.service';
import {
  createExpense,
  createIncome,
  deleteTransaction,
  updateExpense,
} from '@/features/transactions/transaction.service';
import { getDashboardSummary } from './dashboard.service';

/**
 * Run only against a fresh development database. The verifier rejects existing
 * financial data so its exact assertions cannot modify a user's records.
 */
export function verifyDashboardService() {
  if (!__DEV__) throw new Error('Dashboard verification is only available in development.');
  assertFreshFinancialDatabase();

  const now = new Date();
  const currentDate = (day: number) => new Date(now.getFullYear(), now.getMonth(), day, 12);
  const previousDate = (day: number) => new Date(now.getFullYear(), now.getMonth() - 1, day, 12);
  const accountIds: number[] = [];
  const categoryIds: number[] = [];
  const transactionIds: number[] = [];

  try {
    assertEmptyDashboard(now);

    const cash = createAccount({
      name: 'M3A verification cash',
      type: 'cash',
      openingBalanceMinor: 1_000_000,
      currency: 'NPR',
    });
    const bank = createAccount({
      name: 'M3A verification bank',
      type: 'bank',
      openingBalanceMinor: 5_000_000,
      currency: 'NPR',
    });
    accountIds.push(cash.id, bank.id);

    const food = createCategory({ name: 'M3A verification food', type: 'expense' });
    const fuel = createCategory({ name: 'M3A verification fuel', type: 'expense' });
    const shopping = createCategory({ name: 'M3A verification shopping', type: 'expense' });
    const salary = createCategory({ name: 'M3A verification salary', type: 'income' });
    categoryIds.push(food.id, fuel.id, shopping.id, salary.id);

    const previousFood = createExpense({
      amountMinor: 300_000,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: previousDate(15),
      title: 'Previous food',
    });
    const salaryIncome = createIncome({
      amountMinor: 6_500_000,
      categoryId: salary.id,
      accountId: bank.id,
      transactionDate: currentDate(2),
      title: 'Salary',
    });
    const currentFood = createExpense({
      amountMinor: 500_000,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: currentDate(3),
      title: 'Food',
    });
    const currentFuel = createExpense({
      amountMinor: 250_000,
      categoryId: fuel.id,
      accountId: bank.id,
      transactionDate: currentDate(4),
      title: 'Fuel',
    });
    const currentShopping = createExpense({
      amountMinor: 750_000,
      categoryId: shopping.id,
      accountId: bank.id,
      transactionDate: currentDate(5),
      title: 'Shopping',
    });
    transactionIds.push(
      previousFood.id,
      salaryIncome.id,
      currentFood.id,
      currentFuel.id,
      currentShopping.id,
    );

    let summary = getDashboardSummary({ now });
    assert(summary.totalBalanceMinor === 10_700_000, 'Total balance was incorrect.');
    assert(summary.monthlyIncomeMinor === 6_500_000, 'Monthly income included incorrect data.');
    assert(summary.monthlyExpenseMinor === 1_500_000, 'Monthly expense included incorrect data.');
    assert(summary.monthlySavingsMinor === 5_000_000, 'Monthly savings was incorrect.');
    assertCategoryBreakdown(summary, [
      [shopping.id, 750_000, 50],
      [food.id, 500_000, 33],
      [fuel.id, 250_000, 17],
    ]);

    const backdated = createExpense({
      amountMinor: 1,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: previousDate(20),
      title: 'Backdated',
    });
    transactionIds.push(backdated.id);
    summary = getDashboardSummary({ now, recentTransactionLimit: 4 });
    assert(
      summary.totalBalanceMinor === 10_699_999,
      'Backdated transaction did not affect balance.',
    );
    assert(summary.monthlyExpenseMinor === 1_500_000, 'Backdated transaction affected this month.');
    assert(
      summary.recentTransactions.map((transaction) => transaction.id).join(',') ===
        [currentShopping.id, currentFuel.id, currentFood.id, salaryIncome.id].join(','),
      'Recent transactions were not ordered by transaction date.',
    );
    assert(summary.recentTransactions.length === 4, 'Recent transaction limit was ignored.');
    deleteTransaction(backdated.id);
    transactionIds.splice(transactionIds.indexOf(backdated.id), 1);

    updateExpense(currentFood.id, { amountMinor: 800_000 });
    summary = getDashboardSummary({ now });
    assert(summary.totalBalanceMinor === 10_400_000, 'Editing did not update total balance.');
    assert(summary.monthlyExpenseMinor === 1_800_000, 'Editing did not update monthly expense.');
    assert(summary.monthlySavingsMinor === 4_700_000, 'Editing did not update savings.');
    assertCategoryBreakdown(summary, [
      [food.id, 800_000, 44],
      [shopping.id, 750_000, 42],
      [fuel.id, 250_000, 14],
    ]);

    deleteTransaction(currentShopping.id);
    transactionIds.splice(transactionIds.indexOf(currentShopping.id), 1);
    summary = getDashboardSummary({ now });
    assert(summary.totalBalanceMinor === 11_150_000, 'Deleting did not restore total balance.');
    assert(summary.monthlyExpenseMinor === 1_050_000, 'Deleting did not update monthly expense.');
    assert(summary.monthlySavingsMinor === 5_450_000, 'Deleting did not update savings.');
    assertCategoryBreakdown(summary, [
      [food.id, 800_000, 76],
      [fuel.id, 250_000, 24],
    ]);

    archiveAccount(bank.id);
    summary = getDashboardSummary({ now });
    assert(summary.totalBalanceMinor === -100_000, 'Archived account remained in total balance.');
    assert(summary.monthlyIncomeMinor === 6_500_000, 'Archiving changed historical income.');
    assert(summary.monthlyExpenseMinor === 1_050_000, 'Archiving changed historical expense.');
    unarchiveAccount(bank.id);

    return { dashboard: true };
  } finally {
    for (const id of transactionIds) db.delete(transactions).where(eq(transactions.id, id)).run();
    for (const id of accountIds) db.delete(accounts).where(eq(accounts.id, id)).run();
    for (const id of categoryIds) db.delete(categories).where(eq(categories.id, id)).run();
  }
}

function assertEmptyDashboard(now: Date) {
  const summary = getDashboardSummary({ now });
  assert(summary.totalBalanceMinor === 0, 'Empty dashboard total balance was not zero.');
  assert(summary.monthlyIncomeMinor === 0, 'Empty dashboard income was not zero.');
  assert(summary.monthlyExpenseMinor === 0, 'Empty dashboard expense was not zero.');
  assert(summary.monthlySavingsMinor === 0, 'Empty dashboard savings was not zero.');
  assert(summary.categorySpending.length === 0, 'Empty dashboard had category spending.');
  assert(summary.recentTransactions.length === 0, 'Empty dashboard had recent transactions.');
}

function assertFreshFinancialDatabase() {
  const existingAccounts = db.select({ id: accounts.id }).from(accounts).get();
  const existingTransactions = db.select({ id: transactions.id }).from(transactions).get();
  if (existingAccounts || existingTransactions) {
    throw new Error('Dashboard verification requires a fresh development database.');
  }
}

function assertCategoryBreakdown(
  summary: ReturnType<typeof getDashboardSummary>,
  expected: [number, number, number][],
) {
  assert(summary.categorySpending.length === expected.length, 'Category count was incorrect.');
  for (const [index, [id, amountMinor, percentage]] of expected.entries()) {
    const category = summary.categorySpending[index];
    assert(
      category?.categoryId === id &&
        category.amountMinor === amountMinor &&
        category.percentage === percentage,
      'Category spending breakdown was incorrect.',
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
