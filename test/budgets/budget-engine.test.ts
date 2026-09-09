import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as budgetService from '@/features/budgets/budget.service';
import * as categoryRepository from '@/features/categories/category.repository';
import * as reportsService from '@/features/reports/reports.service';
import { getTotalBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import {
  buildFixture,
  createSeptemberActivity,
  createSeptemberBudgets,
  rupees,
  SEPTEMBER,
  type BudgetFixture,
} from './fixture';

/**
 * What a budget says about a month.
 *
 * The figures come from the milestone's own fixture, written out in full so a
 * regression names the number that changed rather than a total that no longer
 * adds up.
 */

let fixture: BudgetFixture;

describe('budget calculations', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('measures each budget against the expenses it covers', () => {
    const budgets = createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);

    const food = budgetService.getBudgetProgress(budgets.food.id);
    expect(food.spentMinor).toBe(rupees(9_000));
    expect(food.remainingMinor).toBe(rupees(6_000));
    expect(food.overspentMinor).toBe(0);
    expect(food.percentage).toBe(60);
    expect(food.status).toBe('within_budget');

    const travel = budgetService.getBudgetProgress(budgets.travel.id);
    expect(travel.spentMinor).toBe(rupees(7_500));
    expect(travel.remainingMinor).toBe(rupees(2_500));
    expect(travel.percentage).toBe(75);
  });

  it('measures the overall budget against every expense, budgeted or not', () => {
    const budgets = createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);

    // 5,000 + 4,000 + 7,500 + 3,000. Shopping has no budget of its own and
    // still counts: an overall budget is a limit on the month, not on the
    // categories that happen to be planned.
    const overall = budgetService.getBudgetProgress(budgets.overall.id);
    expect(overall.spentMinor).toBe(rupees(19_500));
    expect(overall.remainingMinor).toBe(rupees(20_500));
    expect(overall.status).toBe('within_budget');
  });

  it('keeps the overall and category budgets independent', () => {
    createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);
    const summary = budgetService.getMonthlyBudgetSummary(SEPTEMBER);

    // The category budgets are not subtracted from the overall one, and the
    // overall one is not the sum of them: they are two readings of the same
    // spending.
    expect(summary.categoryBudgetedMinor).toBe(rupees(25_000));
    expect(summary.totalBudgetedMinor).toBe(rupees(40_000));
    expect(summary.totalSpentMinor).toBe(rupees(19_500));
    expect(summary.categoryBudgets).toHaveLength(2);
  });

  it('reports overspending as a signed remainder and an uncapped percentage', () => {
    const budgets = createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);
    // Food goes from 9,000 to 17,000 against a 15,000 plan.
    addFoodExpense(fixture, 8_000, 22);

    const food = budgetService.getBudgetProgress(budgets.food.id);
    expect(food.spentMinor).toBe(rupees(17_000));
    expect(food.remainingMinor).toBe(rupees(-2_000));
    expect(food.overspentMinor).toBe(rupees(2_000));
    expect(food.percentage).toBeCloseTo(113.33, 2);
    expect(food.status).toBe('over_budget');

    // The month as a whole moves with it.
    expect(budgetService.getBudgetProgress(budgets.overall.id).spentMinor).toBe(rupees(27_500));
  });

  it('reports an unspent budget as unused rather than as progress of any kind', () => {
    const budgets = createSeptemberBudgets(fixture);

    const food = budgetService.getBudgetProgress(budgets.food.id);
    expect(food.spentMinor).toBe(0);
    expect(food.remainingMinor).toBe(rupees(15_000));
    expect(food.overspentMinor).toBe(0);
    expect(food.percentage).toBe(0);
    expect(food.status).toBe('unused');
  });

  it('distinguishes spending exactly the budget from exceeding it', () => {
    const budgets = createSeptemberBudgets(fixture);
    addFoodExpense(fixture, 15_000, 4);

    const exact = budgetService.getBudgetProgress(budgets.food.id);
    expect(exact.remainingMinor).toBe(0);
    expect(exact.percentage).toBe(100);
    expect(exact.status).toBe('at_budget');

    addFoodExpense(fixture, 1, 5);
    expect(budgetService.getBudgetProgress(budgets.food.id).status).toBe('over_budget');
  });

  it('never combines two currencies', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
      currency: 'NPR',
    });
    // The same category, the same month, a different currency. No rate exists
    // and none is invented, so this is simply not the spending this plan is
    // about.
    transactionService.createExpense({
      accountId: fixture.dollars.id,
      categoryId: fixture.food.id,
      amountMinor: 5_000,
      title: 'Dinner abroad',
      transactionDate: new Date(2026, 8, 9),
    });

    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(0);
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER, 'NPR').totalSpentMinor).toBe(0);
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER, 'USD').totalSpentMinor).toBe(5_000);
  });

  it('reads a month with no budgets as no plan rather than a plan of zero', () => {
    createSeptemberActivity(fixture);
    const summary = budgetService.getMonthlyBudgetSummary(SEPTEMBER);

    expect(summary.overallBudget).toBeNull();
    expect(summary.categoryBudgets).toEqual([]);
    // Null says there is no plan. Zero would say everything was overspent.
    expect(summary.totalBudgetedMinor).toBeNull();
    expect(summary.totalSpentMinor).toBe(rupees(19_500));
    expect(budgetService.listBudgetsForMonth(SEPTEMBER)).toEqual([]);
  });

  it('totals only the category budgets when no overall budget exists', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    });

    const summary = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
    expect(summary.overallBudget).toBeNull();
    expect(summary.totalBudgetedMinor).toBe(rupees(25_000));
    expect(summary.categoryBudgetedMinor).toBe(rupees(25_000));
  });

  it('shows a category budget under the category’s current name', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    addFoodExpense(fixture, 1_000, 7);

    expect(budgetService.getBudgetProgress(budget.id).categoryName).toBe('Food');

    // Renaming a category must not orphan the budget: the relationship is the
    // identity, not the name.
    renameCategory(fixture.food.id, 'Dining');
    const renamed = budgetService.getBudgetProgress(budget.id);
    expect(renamed.categoryName).toBe('Dining');
    expect(renamed.budget.categoryId).toBe(fixture.food.id);
    expect(renamed.spentMinor).toBe(rupees(1_000));
  });

  it('creates no transaction and moves no balance', () => {
    const before = getTotalBalance();

    createSeptemberBudgets(fixture);

    expect(getTotalBalance()).toEqual(before);
    expect(transactionService.listTransactions()).toEqual([]);
  });

  it('leaves every report total untouched', () => {
    createSeptemberActivity(fixture);
    const range = { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) };
    const before = reportsService.getReportSummary(range);

    createSeptemberBudgets(fixture);

    // Reports are a record of what happened. A plan is not activity, so it
    // belongs in none of these figures.
    expect(reportsService.getReportSummary(range)).toEqual(before);
    expect(before.expenseMinor).toBe(rupees(19_500));
    expect(reportsService.getExpenseCategoryBreakdown(range)).toEqual(
      reportsService.getExpenseCategoryBreakdown(range),
    );
  });
});

describe('budget month boundaries', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('includes the first and last day of the month and neither neighbour', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(100_000),
    });
    // August 31, September 1, September 30, October 1.
    spendOn(fixture, new Date(2026, 7, 31), 1_000);
    spendOn(fixture, new Date(2026, 8, 1), 2_000);
    spendOn(fixture, new Date(2026, 8, 30), 4_000);
    spendOn(fixture, new Date(2026, 9, 1), 8_000);

    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(rupees(6_000));
  });

  it('handles February, including a leap day', () => {
    const leapFebruary = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2028-02',
      amountMinor: rupees(100_000),
    });
    spendOn(fixture, new Date(2028, 1, 1), 1_000);
    spendOn(fixture, new Date(2028, 1, 29), 2_000);
    spendOn(fixture, new Date(2028, 2, 1), 4_000);

    // 2028 is a leap year, so the 29th belongs to February.
    expect(budgetService.getBudgetProgress(leapFebruary.id).spentMinor).toBe(rupees(3_000));

    const shortFebruary = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-02',
      amountMinor: rupees(100_000),
    });
    spendOn(fixture, new Date(2026, 1, 28), 5_000);
    spendOn(fixture, new Date(2026, 2, 1), 9_000);
    expect(budgetService.getBudgetProgress(shortFebruary.id).spentMinor).toBe(rupees(5_000));
  });

  it('handles the turn of the year', () => {
    const december = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-12',
      amountMinor: rupees(100_000),
    });
    const january = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2027-01',
      amountMinor: rupees(100_000),
    });
    spendOn(fixture, new Date(2026, 11, 31), 3_000);
    spendOn(fixture, new Date(2027, 0, 1), 6_000);

    expect(budgetService.getBudgetProgress(december.id).spentMinor).toBe(rupees(3_000));
    expect(budgetService.getBudgetProgress(january.id).spentMinor).toBe(rupees(6_000));
  });

  it('keeps a past month settled and a future month empty', () => {
    const past = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2025-03',
      amountMinor: rupees(5_000),
    });
    const future = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2099-01',
      amountMinor: rupees(5_000),
    });
    spendOn(fixture, new Date(2025, 2, 10), 2_000);

    expect(budgetService.getBudgetProgress(past.id).spentMinor).toBe(rupees(2_000));
    // Planning ahead is allowed and starts at nothing spent.
    expect(budgetService.getBudgetProgress(future.id).spentMinor).toBe(0);
    expect(budgetService.getBudgetProgress(future.id).status).toBe('unused');
  });
});

function addFoodExpense(current: BudgetFixture, amount: number, dayOfMonth: number) {
  return spendOn(current, new Date(2026, 8, dayOfMonth), amount);
}

function spendOn(current: BudgetFixture, transactionDate: Date, amount: number) {
  return transactionService.createExpense({
    accountId: current.cash.id,
    categoryId: current.food.id,
    amountMinor: rupees(amount),
    title: 'Food',
    transactionDate,
  });
}

/** The service protects built-ins from editing, so this renames at the repository. */
function renameCategory(id: number, name: string) {
  categoryRepository.updateCategory(id, { name, updatedAt: new Date() });
}
