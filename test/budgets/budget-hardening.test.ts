import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import * as settingsService from '@/features/settings/settings.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import { buildFixture, rupees, type BudgetFixture } from './fixture';

/**
 * M8E budget hardening: the boundaries, the restatements and the extremes.
 *
 * A budget is derived from transactions on every read, so the interesting
 * failures are not arithmetic — they are a transaction counted in the wrong
 * month, counted twice after an edit, or counted at all when its currency
 * differs. Each test below moves something and then asks every affected month
 * what it now says, because the bug these guard against is the one where the
 * month you changed is right and its neighbour is stale.
 */

let fixture: BudgetFixture;

/** An expense on an exact local calendar day, which is what a month is measured on. */
function expenseOn(
  categoryId: number,
  amountMinor: number,
  date: Date,
  accountId: number,
  currency?: string,
) {
  return transactionService.createExpense({
    accountId,
    categoryId,
    amountMinor,
    title: 'Spend',
    transactionDate: date,
    ...(currency === undefined ? {} : { currency }),
  });
}

function spentIn(month: string, currency = 'NPR'): number {
  return budgetService.getMonthlyBudgetSummary(month, currency).totalSpentMinor;
}

describe('budget month boundaries', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('files each boundary day in the month it actually falls in', () => {
    // The last instant of a month and the first of the next, for every boundary
    // the milestone names — including both February ends.
    const days: [string, Date][] = [
      ['2026-01', new Date(2026, 0, 31, 23, 59, 59, 999)],
      ['2026-02', new Date(2026, 1, 1, 0, 0, 0, 0)],
      ['2026-02', new Date(2026, 1, 28, 23, 59, 59, 999)],
      ['2026-03', new Date(2026, 2, 1, 0, 0, 0, 0)],
      ['2026-04', new Date(2026, 3, 30, 23, 59, 59, 999)],
      ['2026-05', new Date(2026, 4, 1, 0, 0, 0, 0)],
      ['2026-12', new Date(2026, 11, 31, 23, 59, 59, 999)],
      ['2027-01', new Date(2027, 0, 1, 0, 0, 0, 0)],
    ];
    for (const [, date] of days) {
      expenseOn(fixture.food.id, rupees(100), date, fixture.cash.id);
    }

    // Each of those months holds exactly the days that belong to it, and the
    // half-open range means no day is counted in two months or dropped between.
    expect(spentIn('2026-01')).toBe(rupees(100));
    expect(spentIn('2026-02')).toBe(rupees(200));
    expect(spentIn('2026-03')).toBe(rupees(100));
    expect(spentIn('2026-04')).toBe(rupees(100));
    expect(spentIn('2026-05')).toBe(rupees(100));
    expect(spentIn('2026-12')).toBe(rupees(100));
    expect(spentIn('2027-01')).toBe(rupees(100));
  });

  it('counts February 29 in a leap year’s February', () => {
    expenseOn(fixture.food.id, rupees(500), new Date(2028, 1, 29, 12), fixture.cash.id);

    expect(spentIn('2028-02')).toBe(rupees(500));
    expect(spentIn('2028-03')).toBe(0);
  });

  it('measures the month a transaction is dated, not the month it was entered', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-08',
      amountMinor: rupees(10_000),
    });
    // Entered now, dated August: August's budget is what moves.
    expenseOn(fixture.food.id, rupees(3_000), new Date(2026, 7, 15, 12), fixture.cash.id);

    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(rupees(3_000));
    expect(spentIn('2026-09')).toBe(0);
  });
});

describe('restating what was already recorded', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });

  it('recalculates every neighbouring month when an expense is backdated', () => {
    const expense = expenseOn(
      fixture.food.id,
      rupees(2_000),
      new Date(2026, 8, 10, 12),
      fixture.cash.id,
    );
    expect(spentIn('2026-09')).toBe(rupees(2_000));

    transactionService.updateExpense(expense.id, {
      transactionDate: new Date(2026, 7, 10, 12),
    });
    expect(spentIn('2026-08')).toBe(rupees(2_000));
    expect(spentIn('2026-09')).toBe(0);

    transactionService.updateExpense(expense.id, {
      transactionDate: new Date(2026, 9, 10, 12),
    });
    expect(spentIn('2026-08')).toBe(0);
    expect(spentIn('2026-09')).toBe(0);
    expect(spentIn('2026-10')).toBe(rupees(2_000));
  });

  it('leaves no phantom spending behind when a category is moved repeatedly', () => {
    const budgets = {
      food: budgetService.createBudget({
        categoryId: fixture.food.id,
        periodMonth: '2026-09',
        amountMinor: rupees(15_000),
      }),
      travel: budgetService.createBudget({
        categoryId: fixture.travel.id,
        periodMonth: '2026-09',
        amountMinor: rupees(15_000),
      }),
      shopping: budgetService.createBudget({
        categoryId: fixture.shopping.id,
        periodMonth: '2026-09',
        amountMinor: rupees(15_000),
      }),
    };
    const expense = expenseOn(
      fixture.food.id,
      rupees(4_000),
      new Date(2026, 8, 10, 12),
      fixture.cash.id,
    );

    const spent = () => ({
      food: budgetService.getBudgetProgress(budgets.food.id).spentMinor,
      travel: budgetService.getBudgetProgress(budgets.travel.id).spentMinor,
      shopping: budgetService.getBudgetProgress(budgets.shopping.id).spentMinor,
    });

    for (const categoryId of [
      fixture.travel.id,
      fixture.shopping.id,
      fixture.food.id,
      fixture.travel.id,
    ]) {
      transactionService.updateExpense(expense.id, { categoryId });
    }
    // Four moves, and the amount is in exactly one place — the last one.
    expect(spent()).toEqual({ food: 0, travel: rupees(4_000), shopping: 0 });

    transactionService.updateExpense(expense.id, { categoryId: fixture.food.id });
    expect(spent()).toEqual({ food: rupees(4_000), travel: 0, shopping: 0 });
    // And the month total never multiplied along the way.
    expect(spentIn('2026-09')).toBe(rupees(4_000));
  });

  it('reflects only the latest budget amount after repeated edits', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(1_000),
    });
    expenseOn(fixture.food.id, rupees(600), new Date(2026, 8, 10, 12), fixture.cash.id);

    for (const amountMinor of [rupees(10_000), rupees(500), rupees(3_000)]) {
      budgetService.updateBudget(budget.id, { amountMinor });
    }

    const progress = budgetService.getBudgetProgress(budget.id);
    expect(progress.budget.amountMinor).toBe(rupees(3_000));
    expect(progress.spentMinor).toBe(rupees(600));
    expect(progress.remainingMinor).toBe(rupees(2_400));
  });

  it('drops a deleted expense from the budget exactly once', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    const first = expenseOn(
      fixture.food.id,
      rupees(5_000),
      new Date(2026, 8, 4, 12),
      fixture.cash.id,
    );
    expenseOn(fixture.food.id, rupees(2_000), new Date(2026, 8, 6, 12), fixture.cash.id);
    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(rupees(7_000));

    transactionService.deleteTransaction(first.id);
    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(rupees(2_000));
  });
});

describe('currency', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });

  it('counts only the budget’s own currency, and never adds across currencies', () => {
    const rupeeAccount = fixture.cash;
    const dollarAccount = fixture.dollars;
    const indian = accountService.createAccount({
      name: 'India',
      type: 'bank',
      openingBalanceMinor: rupees(100_000),
      currency: 'INR',
    });

    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
      currency: 'NPR',
    });

    const day = new Date(2026, 8, 10, 12);
    expenseOn(fixture.food.id, rupees(4_000), day, rupeeAccount.id);
    expenseOn(fixture.food.id, rupees(3_000), day, dollarAccount.id, 'USD');
    expenseOn(fixture.food.id, rupees(9_000), day, indian.id, 'INR');

    // 4,000 NPR. Not 16,000 of some currency that does not exist.
    expect(budgetService.getBudgetProgress(budget.id).spentMinor).toBe(rupees(4_000));
    expect(spentIn('2026-09', 'NPR')).toBe(rupees(4_000));
    expect(spentIn('2026-09', 'USD')).toBe(rupees(3_000));
    expect(spentIn('2026-09', 'INR')).toBe(rupees(9_000));
  });

  it('leaves a historical budget’s currency alone when the default changes', () => {
    const budget = budgetService.createBudget({
      periodMonth: '2026-09',
      amountMinor: rupees(40_000),
    });
    expect(budget.currency).toBe('NPR');

    settingsService.updateDefaultCurrency('USD');

    // The plan was made in rupees and stays a rupee plan; only the next one made
    // without an explicit currency follows the new default.
    expect(budgetService.getBudget(budget.id).currency).toBe('NPR');
    const later = budgetService.createBudget({
      periodMonth: '2026-10',
      amountMinor: rupees(300),
    });
    expect(later.currency).toBe('USD');
  });
});

describe('the edges of the scale', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });

  it('treats spending exactly to the limit as reached, not exceeded', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(10_000),
    });
    expenseOn(fixture.food.id, rupees(6_000), new Date(2026, 8, 4, 12), fixture.cash.id);
    expenseOn(fixture.food.id, rupees(4_000), new Date(2026, 8, 9, 12), fixture.cash.id);

    const progress = budgetService.getBudgetProgress(budget.id);
    expect(progress.spentMinor).toBe(rupees(10_000));
    expect(progress.remainingMinor).toBe(0);
    expect(progress.overspentMinor).toBe(0);
    expect(progress.percentage).toBe(100);
    expect(progress.status).toBe('at_budget');
  });

  it('reports an extreme overspend truthfully rather than capping it', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(1_000),
    });
    expenseOn(fixture.food.id, rupees(100_000), new Date(2026, 8, 4, 12), fixture.cash.id);

    const progress = budgetService.getBudgetProgress(budget.id);
    expect(progress.percentage).toBe(10_000);
    expect(progress.remainingMinor).toBe(rupees(-99_000));
    expect(progress.overspentMinor).toBe(rupees(99_000));
    expect(progress.status).toBe('over_budget');
    expect(Number.isFinite(progress.percentage)).toBe(true);
  });

  it('keeps exact integers at the top of the safe range', () => {
    const half = 4_503_599_627_370_495;
    const limit = Number.MAX_SAFE_INTEGER; // half + (half + 1)
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: limit,
    });
    expenseOn(fixture.food.id, half, new Date(2026, 8, 4, 12), fixture.cash.id);
    expenseOn(fixture.food.id, half + 1, new Date(2026, 8, 5, 12), fixture.cash.id);

    const progress = budgetService.getBudgetProgress(budget.id);
    // Exact to the minor unit: no float rounding anywhere in the sum.
    expect(progress.spentMinor).toBe(limit);
    expect(Number.isSafeInteger(progress.spentMinor)).toBe(true);
    expect(progress.remainingMinor).toBe(0);
    expect(progress.status).toBe('at_budget');
  });
});

describe('a month with no budget', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });

  it('says nothing was planned rather than that nothing was allowed', () => {
    expenseOn(fixture.food.id, rupees(12_000), new Date(2026, 8, 4, 12), fixture.cash.id);

    const summary = budgetService.getMonthlyBudgetSummary('2026-09');
    // No plan is the absence of a limit, not a limit of zero.
    expect(summary.overallBudget).toBeNull();
    expect(summary.categoryBudgets).toEqual([]);
    expect(summary.totalBudgetedMinor).toBeNull();
    expect(summary.totalSpentMinor).toBe(rupees(12_000));
  });

  it('never presents the overall and category plans as one larger total', () => {
    budgetService.createBudget({ periodMonth: '2026-09', amountMinor: rupees(50_000) });
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: '2026-09',
      amountMinor: rupees(10_000),
    });

    const summary = budgetService.getMonthlyBudgetSummary('2026-09');
    // The month's limit is 50,000. The category plans are scopes inside it, not
    // additions to it, so 75,000 must appear nowhere.
    expect(summary.totalBudgetedMinor).toBe(rupees(50_000));
    expect(summary.categoryBudgetedMinor).toBe(rupees(25_000));
    expect(summary.totalBudgetedMinor).not.toBe(rupees(75_000));
  });
});
