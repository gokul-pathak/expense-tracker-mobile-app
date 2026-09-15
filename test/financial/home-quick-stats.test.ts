import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { listExpenseCategories } from '@/features/categories/category.service';
import {
  getHomeCashflow,
  getHomePeopleTotals,
} from '@/features/dashboard/home-quick-stats.service';
import { getReportSummary } from '@/features/reports/reports.service';
import * as transactions from '@/features/transactions/transaction.service';

import { buildCanonical, NOW, rupees, september } from '../release/fixture';
import { incomeCategory, makeAccount, makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

/**
 * Home's quick figures: who owes whom, and the last seven days. Each is checked
 * against the screen that owns the same money, so Home never has a second
 * opinion about it.
 */
describe('Home quick stats', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('shows what People shows: Ram owes 5,000 and 8,000 is owed to Sita', () => {
    buildCanonical();
    const people = getHomePeopleTotals({ currency: 'NPR' });
    expect(people).toEqual({
      currency: 'NPR',
      receivableMinor: rupees(5_000),
      liabilityMinor: rupees(8_000),
      otherCurrencies: [],
    });
    const npr = transactions
      .getPeopleFinancialSummaryByCurrency()
      .find((group) => group.currency === 'NPR');
    expect([people.receivableMinor, people.liabilityMinor]).toEqual([
      npr?.totalReceivableMinor,
      npr?.totalLiabilityMinor,
    ]);
  });

  it('names a debt in another currency and adds it to nothing', () => {
    buildCanonical();
    const dollars = makeAccount('Dollar Card', 'USD', rupees(1_000));
    transactions.createLend({
      personId: makePerson('John').id,
      amountMinor: rupees(200),
      accountId: dollars.id,
      transactionDate: september(10),
    });
    expect(getHomePeopleTotals({ currency: 'NPR' })).toEqual({
      currency: 'NPR',
      receivableMinor: rupees(5_000),
      liabilityMinor: rupees(8_000),
      otherCurrencies: ['USD'],
    });
  });

  it('reads zero rather than failing before anyone has borrowed or lent', () => {
    expect(getHomePeopleTotals({ currency: 'NPR' })).toEqual({
      currency: 'NPR',
      receivableMinor: 0,
      liabilityMinor: 0,
      otherCurrencies: [],
    });
  });

  it('counts the seven days ending today, income and expense only, in one currency', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(50_000));
    const bank = makeAccount('Bank', 'NPR', rupees(50_000));
    const dollars = makeAccount('Dollar Card', 'USD', rupees(1_000));
    const food = listExpenseCategories()[0]!;
    const salary = incomeCategory();

    // NOW is 25 September, so the week is 19 to 25 September.
    transactions.createIncome({
      amountMinor: rupees(9_000),
      categoryId: salary.id,
      accountId: bank.id,
      transactionDate: september(19),
      title: 'Salary',
    });
    transactions.createExpense({
      amountMinor: rupees(700),
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: september(22),
      title: 'Lunch',
    });
    transactions.createExpense({
      amountMinor: rupees(1_200),
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: september(25),
      title: 'Groceries',
    });

    // Before the week, not income or expense, or in another currency: none of these count.
    transactions.createExpense({
      amountMinor: rupees(3_000),
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: september(18),
      title: 'Last week',
    });
    transactions.createTransfer({
      amountMinor: rupees(5_000),
      sourceAccountId: bank.id,
      destinationAccountId: cash.id,
      transactionDate: september(23),
    });
    transactions.createLend({
      personId: makePerson('Ram').id,
      amountMinor: rupees(2_000),
      accountId: cash.id,
      transactionDate: september(24),
    });
    transactions.createExpense({
      amountMinor: rupees(40),
      categoryId: food.id,
      accountId: dollars.id,
      transactionDate: september(24),
      title: 'Dollars',
    });

    const week = getHomeCashflow({ now: NOW, currency: 'NPR' });
    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.start).toEqual(new Date(2026, 8, 19));
    expect(week.days[6]?.start).toEqual(new Date(2026, 8, 25));
    expect(week.days.map((day) => day.incomeMinor)).toEqual([rupees(9_000), 0, 0, 0, 0, 0, 0]);
    expect(week.days.map((day) => day.expenseMinor)).toEqual([
      0,
      0,
      0,
      rupees(700),
      0,
      0,
      rupees(1_200),
    ]);
    expect([week.incomeMinor, week.expenseMinor]).toEqual([rupees(9_000), rupees(1_900)]);

    // The same week on Reports is the same money.
    const reports = getReportSummary(
      { start: new Date(2026, 8, 19), end: new Date(2026, 8, 26) },
      { currency: 'NPR' },
    );
    expect([reports.incomeMinor, reports.expenseMinor]).toEqual([
      week.incomeMinor,
      week.expenseMinor,
    ]);
  });
});
