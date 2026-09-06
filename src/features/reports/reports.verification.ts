import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { people } from '@/db/schema/people';
import { transactions } from '@/db/schema/transactions';
import { archiveAccount, createAccount } from '@/features/accounts/account.service';
import { createCategory } from '@/features/categories/category.service';
import { createPerson } from '@/features/people/person.service';
import { ValidationError } from '@/features/shared/errors';
import {
  createBorrow,
  createExpense,
  createIncome,
  createLend,
  createRepaymentPaid,
  createRepaymentReceived,
  createTransfer,
  deleteTransaction,
  updateExpense,
} from '@/features/transactions/transaction.service';

import {
  getCustomRange,
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getMonthlyComparison,
  getReportRange,
  getReportSummary,
  getSimpleInsights,
} from './reports.service';

/** Run only against a fresh development database. Fixtures are removed afterwards. */
export function verifyReportsService() {
  if (!__DEV__) throw new Error('Reports verification is only available in development.');
  assertFreshFinancialDatabase();

  const now = new Date(2026, 8, 20, 12);
  const accountIds: number[] = [];
  const categoryIds: number[] = [];
  const personIds: number[] = [];
  const transactionIds: number[] = [];
  let reportAccountId: number | undefined;
  try {
    const account = createAccount({
      name: 'M5A cash',
      type: 'cash',
      openingBalanceMinor: 0,
      currency: 'NPR',
    });
    const otherAccount = createAccount({
      name: 'M5A bank',
      type: 'bank',
      openingBalanceMinor: 0,
      currency: 'NPR',
    });
    accountIds.push(account.id, otherAccount.id);
    reportAccountId = account.id;
    const food = category('M5A Food', 'expense');
    const fuel = category('M5A Fuel', 'expense');
    const shopping = category('M5A Shopping', 'expense');
    const bills = category('M5A Bills', 'expense');
    const salary = category('M5A Salary', 'income');
    const freelance = category('M5A Freelance', 'income');
    const ram = createPerson({ name: 'M5A Ram' });
    const sita = createPerson({ name: 'M5A Sita' });
    personIds.push(ram.id, sita.id);

    assertSummary(getReportRange('this_month', now), 0, 0, 0);
    income(60_000, salary.id, 6, 2);
    expense(10_000, food.id, 6, 3);
    expense(5_000, fuel.id, 6, 4);
    income(65_000, salary.id, 7, 2);
    income(10_000, freelance.id, 7, 3);
    expense(12_000, food.id, 7, 4);
    expense(8_000, shopping.id, 7, 5);
    expense(5_000, bills.id, 7, 6);
    income(70_000, salary.id, 8, 2);
    const septemberFood = expense(15_000, food.id, 8, 15);
    expense(6_000, fuel.id, 8, 3);
    expense(10_000, shopping.id, 8, 4);
    expense(4_000, bills.id, 8, 5);

    assertSummary(getReportRange('last_3_months', now), 205_000, 75_000, 130_000);
    assertSummary(getReportRange('this_month', now), 70_000, 35_000, 35_000);
    assertSummary(getReportRange('last_1_month', now), 70_000, 35_000, 35_000);
    assertSummary(getReportRange('last_month', now), 75_000, 25_000, 50_000);
    assertSummary(getReportRange('last_6_months', now), 205_000, 75_000, 130_000);
    assertSummary(getReportRange('this_week', now), 0, 15_000, -15_000);
    assertSummary(getReportRange('this_year', now), 205_000, 75_000, 130_000);
    assertSummary(
      getCustomRange(new Date(2026, 7, 1), new Date(2026, 8, 1)),
      75_000,
      25_000,
      50_000,
    );
    expectError(() => getCustomRange(new Date(2026, 8, 1), new Date(2026, 8, 1)), ValidationError);

    const breakdown = getExpenseCategoryBreakdown(getReportRange('this_month', now));
    assertBreakdown(breakdown, [
      [food.id, 15_000],
      [shopping.id, 10_000],
      [fuel.id, 6_000],
      [bills.id, 4_000],
    ]);
    assert(
      Math.round(breakdown[0]!.percentage) === 43 && Math.round(breakdown[3]!.percentage) === 11,
      'Category percentages were incorrect.',
    );
    assert(
      getExpenseCategoryBreakdown(getReportRange('this_week', now)).length === 1,
      'Weekly category breakdown was incorrect.',
    );

    const trend = getIncomeExpenseTrend(getReportRange('last_3_months', now), 'month', { now });
    assert(trend.length === 3, 'Monthly trend did not contain continuous buckets.');
    assertTrend(trend, [
      [60_000, 15_000],
      [75_000, 25_000],
      [70_000, 35_000],
    ]);
    assertTrend(getIncomeExpenseTrend(getReportRange('last_6_months', now), 'month', { now }), [
      [0, 0],
      [0, 0],
      [0, 0],
      [60_000, 15_000],
      [75_000, 25_000],
      [70_000, 35_000],
    ]);
    const weeklyTrend = getIncomeExpenseTrend(getReportRange('this_week', now), 'day', { now });
    assert(
      weeklyTrend.length === 7 && weeklyTrend[1]!.expenseMinor === 15_000,
      'Weekly daily buckets were incorrect.',
    );
    const comparison = getMonthlyComparison({ now });
    assert(
      comparison.differenceMinor === 10_000 && comparison.percentageChange === 40,
      'Monthly comparison was incorrect.',
    );
    assert(
      getMonthlyComparison({ now: new Date(2026, 6, 20, 12) }).percentageChange === null,
      'Zero-baseline comparison was not safe.',
    );
    const insights = getSimpleInsights(getReportRange('this_month', now), { now });
    assert(
      insights.some(
        (insight) => insight.type === 'biggest_expense_category' && insight.categoryId === food.id,
      ),
      'Biggest-category insight was missing.',
    );
    assert(
      insights.some((insight) => insight.type === 'expense_increase' && insight.percentage === 40),
      'Expense-increase insight was missing.',
    );

    const beforeNonReport = getReportSummary(getReportRange('this_month', now));
    const beforeNonReportTrend = getIncomeExpenseTrend(getReportRange('this_month', now), 'day', {
      now,
    });
    transactionIds.push(
      createTransfer({
        amountMinor: 20_000,
        sourceAccountId: account.id,
        destinationAccountId: otherAccount.id,
        transactionDate: date(8, 10),
      }).id,
    );
    const lend = createLend({
      personId: ram.id,
      amountMinor: 8_000,
      accountId: account.id,
      transactionDate: date(8, 10),
    });
    transactionIds.push(lend.id);
    const borrow = createBorrow({
      personId: sita.id,
      amountMinor: 5_000,
      accountId: account.id,
      transactionDate: date(8, 10),
    });
    transactionIds.push(borrow.id);
    transactionIds.push(
      createRepaymentReceived({
        personId: ram.id,
        amountMinor: 2_000,
        accountId: account.id,
        transactionDate: date(8, 10),
      }).id,
    );
    transactionIds.push(
      createRepaymentPaid({
        personId: sita.id,
        amountMinor: 1_000,
        accountId: account.id,
        transactionDate: date(8, 10),
      }).id,
    );
    assertSummary(
      getReportRange('this_month', now),
      beforeNonReport.incomeMinor,
      beforeNonReport.expenseMinor,
      beforeNonReport.savingsMinor,
    );
    assert(
      JSON.stringify(getIncomeExpenseTrend(getReportRange('this_month', now), 'day', { now })) ===
        JSON.stringify(beforeNonReportTrend),
      'Non-report transactions changed the trend.',
    );

    const backdated = expense(1, food.id, 7, 20);
    assertSummary(getReportRange('this_month', now), 70_000, 35_000, 35_000);
    deleteTransaction(backdated.id);
    transactionIds.splice(transactionIds.indexOf(backdated.id), 1);
    updateExpense(septemberFood.id, { amountMinor: 18_000 });
    assertSummary(getReportRange('this_month', now), 70_000, 38_000, 32_000);
    deleteTransaction(septemberFood.id);
    transactionIds.splice(transactionIds.indexOf(septemberFood.id), 1);
    assertSummary(getReportRange('this_month', now), 70_000, 20_000, 50_000);

    archiveAccount(account.id);
    assertSummary(getReportRange('this_month', now), 70_000, 20_000, 50_000);
    return { reports: true };
  } finally {
    for (const id of transactionIds) db.delete(transactions).where(eq(transactions.id, id)).run();
    for (const id of personIds) db.delete(people).where(eq(people.id, id)).run();
    for (const id of accountIds) db.delete(accounts).where(eq(accounts.id, id)).run();
    for (const id of categoryIds) db.delete(categories).where(eq(categories.id, id)).run();
  }

  function category(name: string, type: 'income' | 'expense') {
    const created = createCategory({ name, type });
    categoryIds.push(created.id);
    return created;
  }
  function date(month: number, day: number) {
    return new Date(2026, month, day, 12);
  }
  function income(amountMinor: number, categoryId: number, month: number, day: number) {
    const created = createIncome({
      amountMinor,
      categoryId,
      accountId: reportAccountId!,
      transactionDate: date(month, day),
    });
    transactionIds.push(created.id);
    return created;
  }
  function expense(amountMinor: number, categoryId: number, month: number, day: number) {
    const created = createExpense({
      amountMinor,
      categoryId,
      accountId: reportAccountId!,
      transactionDate: date(month, day),
    });
    transactionIds.push(created.id);
    return created;
  }
}

function assertFreshFinancialDatabase() {
  if (
    db.select({ id: accounts.id }).from(accounts).get() ||
    db.select({ id: transactions.id }).from(transactions).get()
  )
    throw new Error('Reports verification requires a fresh development database.');
}
function assertSummary(
  range: ReturnType<typeof getReportRange>,
  income: number,
  expense: number,
  savings: number,
) {
  const summary = getReportSummary(range);
  assert(
    summary.incomeMinor === income &&
      summary.expenseMinor === expense &&
      summary.savingsMinor === savings,
    'Report summary was incorrect.',
  );
}
function assertBreakdown(
  items: ReturnType<typeof getExpenseCategoryBreakdown>,
  expected: [number, number][],
) {
  assert(
    items.length === expected.length &&
      items.every(
        (item, index) =>
          item.categoryId === expected[index]![0] && item.amountMinor === expected[index]![1],
      ),
    'Category breakdown was incorrect.',
  );
}
function assertTrend(
  items: ReturnType<typeof getIncomeExpenseTrend>,
  expected: [number, number][],
) {
  assert(
    items.length === expected.length &&
      items.every(
        (item, index) =>
          item.incomeMinor === expected[index]![0] && item.expenseMinor === expected[index]![1],
      ),
    'Trend data was incorrect.',
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
