import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import {
  formatBudgetPercentage,
  getBudgetRemainderLabel,
} from '@/features/budgets/budget-presentation';
import * as budgetService from '@/features/budgets/budget.service';
import { getHomeBudgetSummary } from '@/features/dashboard/dashboard-budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import type { DashboardSummary } from '@/features/dashboard/dashboard.types';
import * as transactionService from '@/features/transactions/transaction.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import { buildFixture, rupees, type BudgetFixture } from './fixture';

/**
 * Home's budget section.
 *
 * Two things are being protected here. Home must read the plan from the budget
 * engine rather than summing expenses a second time, and Home's existing
 * accounting — balance, income, expense, savings, category spending — must be
 * exactly what it was before a budget existed. A planning figure that moved a
 * balance would be the worst bug this feature could have.
 *
 * Home always means *this* month, so the fixture is built in the current
 * calendar month rather than in the milestone's September.
 */

let fixture: BudgetFixture;

const today = new Date();
/** Mid-month, so the same date is valid in February and in a leap year alike. */
const thisMonth = (dayOfMonth = 15) =>
  new Date(today.getFullYear(), today.getMonth(), dayOfMonth, 12, 0, 0);

function spend(categoryId: number, amount: number, title: string) {
  return transactionService.createExpense({
    accountId: fixture.cash.id,
    categoryId,
    amountMinor: rupees(amount),
    title,
    paymentMode: 'cash',
    transactionDate: thisMonth(),
  });
}

/** The dashboard figures a budget must never touch. */
function accounting(summary: DashboardSummary) {
  return {
    totalBalanceMinor: summary.totalBalanceMinor,
    monthlyIncomeMinor: summary.monthlyIncomeMinor,
    monthlyExpenseMinor: summary.monthlyExpenseMinor,
    monthlySavingsMinor: summary.monthlySavingsMinor,
    categorySpending: summary.categorySpending,
  };
}

describe('home budget summary', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('shows nothing to compare against until a budget exists', () => {
    spend(fixture.food.id, 5_000, 'Dinner');
    const summary = getHomeBudgetSummary();

    expect(summary.hasAnyBudget).toBe(false);
    expect(summary.overall).toBeNull();
    expect(summary.highlights).toEqual([]);
    // No fake zero-of-zero: Home offers to set one instead of inventing a plan.
    expect(summary.categoryBudgetCount).toBe(0);
  });

  it('reads this month, not the latest month that happens to hold a budget', () => {
    budgetService.createBudget({ periodMonth: '2020-01', amountMinor: rupees(99_000) });
    const summary = getHomeBudgetSummary();

    expect(summary.month).not.toBe('2020-01');
    expect(summary.hasAnyBudget).toBe(false);
  });

  it('states the overall plan the way Home prints it', () => {
    budgetService.createBudget({
      periodMonth: summaryMonth(),
      amountMinor: rupees(40_000),
    });
    spend(fixture.food.id, 5_000, 'Dinner');
    spend(fixture.food.id, 4_000, 'Groceries run');
    spend(fixture.travel.id, 7_500, 'Bus fare');
    spend(fixture.shopping.id, 3_000, 'Shoes');

    const overall = getHomeBudgetSummary().overall!;
    expect(overall.spentMinor).toBe(rupees(19_500));
    expect(overall.budget.amountMinor).toBe(rupees(40_000));
    expect(getBudgetRemainderLabel(overall, { code: false })).toBe('20,500.00 remaining');
    expect(formatBudgetPercentage(overall.percentage)).toBe('48.75%');
  });

  it('picks the few categories worth a glance, over budget first', () => {
    const month = summaryMonth();
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: month,
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: month,
      amountMinor: rupees(10_000),
    });
    budgetService.createBudget({
      categoryId: fixture.shopping.id,
      periodMonth: month,
      amountMinor: rupees(20_000),
    });
    spend(fixture.food.id, 17_000, 'Feast');
    spend(fixture.travel.id, 7_500, 'Bus fare');
    spend(fixture.shopping.id, 1_000, 'Socks');

    const summary = getHomeBudgetSummary({ highlightLimit: 2 });
    expect(summary.highlights.map((item) => item.categoryName)).toEqual(['Food', 'Travel']);
    expect(summary.categoryBudgetCount).toBe(3);
  });

  it('never presents a sum of category budgets as an overall budget', () => {
    const month = summaryMonth();
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: month,
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: month,
      amountMinor: rupees(10_000),
    });

    const summary = getHomeBudgetSummary();
    // The sum is available, and it is not the overall budget. Home says
    // "Budgets" rather than "Monthly Budget" precisely because this is null.
    expect(summary.overall).toBeNull();
    expect(summary.categoryBudgetedMinor).toBe(rupees(25_000));
    expect(summary.hasAnyBudget).toBe(true);
  });
});

describe('home accounting is unchanged by budgets', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    spend(fixture.food.id, 9_000, 'Food');
    spend(fixture.travel.id, 7_500, 'Travel');
    transactionService.createIncome({
      accountId: fixture.bank.id,
      categoryId: fixture.salary.id,
      amountMinor: rupees(65_000),
      title: 'Salary',
      transactionDate: thisMonth(1),
    });
  });
  afterAll(() => closeTestDatabase());

  it('keeps every dashboard metric identical across budget create, edit and delete', () => {
    const before = accounting(getDashboardSummary());

    const budget = budgetService.createBudget({
      periodMonth: summaryMonth(),
      amountMinor: rupees(40_000),
    });
    expect(accounting(getDashboardSummary())).toEqual(before);

    budgetService.updateBudget(budget.id, { amountMinor: rupees(25_000) });
    expect(accounting(getDashboardSummary())).toEqual(before);

    budgetService.deleteBudget(budget.id);
    expect(accounting(getDashboardSummary())).toEqual(before);
  });

  it('agrees with the dashboard about what was spent rather than counting again', () => {
    budgetService.createBudget({ periodMonth: summaryMonth(), amountMinor: rupees(40_000) });

    const dashboard = getDashboardSummary();
    const budget = getHomeBudgetSummary();
    // One figure, one source. Home's expense total and the budget's spent total
    // are the same month's expenses read by the same rule.
    expect(budget.overall?.spentMinor).toBe(dashboard.monthlyExpenseMinor);
  });
});

/** The month Home is always about: the current local calendar month. */
function summaryMonth() {
  return getHomeBudgetSummary().month;
}
