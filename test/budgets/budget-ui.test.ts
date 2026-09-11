import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import {
  categoryLabel,
  formatBudgetPercentage,
  getBudgetRemainderLabel,
  getBudgetStatusLabel,
  sortBudgetProgress,
  stepPeriodMonth,
} from '@/features/budgets/budget-presentation';
import * as budgetService from '@/features/budgets/budget.service';
import * as categoryRepository from '@/features/categories/category.repository';
import { applyRemoteTombstone } from '@/features/sync/remote-apply.repository';
import { getTotalBalance } from '@/features/dashboard/dashboard.service';
import { getReportSummary } from '@/features/reports/reports.service';
import { ConflictError, ValidationError } from '@/features/shared/errors';
import { countPendingSyncMutations, getPendingSyncMutation } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';
import { getCurrentMonthRange, getMonthRange } from '@/utils/date-range';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import {
  AUGUST,
  buildFixture,
  createSeptemberActivity,
  createSeptemberBudgets,
  rupees,
  SEPTEMBER,
  type BudgetFixture,
} from './fixture';

/**
 * What a budget screen would show, asserted where a test can reach it.
 *
 * A screen here is a thin arrangement of one service call and one presentation
 * module, so this drives exactly that pair: the summary the screen asks for, and
 * the sentences it puts on the row. What is not asserted through a rendered tree
 * is the layout; what is asserted is every figure and every word.
 */

let fixture: BudgetFixture;

/** The month view a budgets screen renders, in the order it renders it. */
function monthView(month: string) {
  const summary = budgetService.getMonthlyBudgetSummary(month);
  return { ...summary, categoryBudgets: sortBudgetProgress(summary.categoryBudgets) };
}

describe('budgets screen', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('has an empty month to show before anything is planned', () => {
    const view = monthView(SEPTEMBER);
    expect(view.overallBudget).toBeNull();
    expect(view.categoryBudgets).toEqual([]);
    // Null, not zero. "No budget set" and "a budget of nothing" are different.
    expect(view.totalBudgetedMinor).toBeNull();
  });

  it('shows the month exactly as the milestone specifies it', () => {
    createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);
    const view = monthView(SEPTEMBER);

    expect(view.overallBudget?.spentMinor).toBe(rupees(19_500));
    expect(view.overallBudget?.budget.amountMinor).toBe(rupees(40_000));
    expect(view.overallBudget?.remainingMinor).toBe(rupees(20_500));
    expect(formatBudgetPercentage(view.overallBudget!.percentage)).toBe('48.75%');

    const [travel, food] = view.categoryBudgets;
    // Travel is at 75% and Food at 60%, so Travel leads: nearest to its limit first.
    expect(travel?.categoryName).toBe('Travel');
    expect(travel?.spentMinor).toBe(rupees(7_500));
    expect(getBudgetRemainderLabel(travel!, { code: false })).toBe('2,500.00 remaining');
    expect(formatBudgetPercentage(travel!.percentage)).toBe('75%');

    expect(food?.categoryName).toBe('Food');
    expect(food?.spentMinor).toBe(rupees(9_000));
    expect(getBudgetRemainderLabel(food!, { code: false })).toBe('6,000.00 remaining');
    expect(formatBudgetPercentage(food!.percentage)).toBe('60%');
  });

  it('shows an overspent category as over budget, with the true percentage', () => {
    const budgets = createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(8_000),
      title: 'Feast',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 8, 25),
    });

    const view = monthView(SEPTEMBER);
    const food = view.categoryBudgets[0];
    // Over budget sorts first, whatever the percentages below it are.
    expect(food?.budget.id).toBe(budgets.food.id);
    expect(food?.spentMinor).toBe(rupees(17_000));
    expect(getBudgetStatusLabel(food!)).toBe('Over budget');
    expect(getBudgetRemainderLabel(food!, { code: false })).toBe('2,000.00 over budget');
    expect(formatBudgetPercentage(food!.percentage)).toBe('113.33%');
  });

  it('says nothing has been spent rather than warning about it', () => {
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    });
    const travel = monthView(SEPTEMBER).categoryBudgets[0]!;
    expect(getBudgetStatusLabel(travel)).toBe('No spending yet');
    expect(getBudgetRemainderLabel(travel, { code: false })).toBe('10,000.00 remaining');
  });

  it('reports reaching the limit exactly as reaching it', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(5_000),
    });
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(5_000),
      title: 'Exactly',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 8, 4),
    });
    const food = monthView(SEPTEMBER).categoryBudgets[0]!;
    expect(getBudgetStatusLabel(food)).toBe('Budget reached');
    expect(getBudgetRemainderLabel(food)).toBe('Budget reached');
  });
});

describe('budgets screen month navigation', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);
  });
  afterAll(() => closeTestDatabase());

  it('shows a different month when the stepper moves, without touching September', () => {
    const previous = stepPeriodMonth(SEPTEMBER, -1);
    expect(previous).toBe(AUGUST);

    const august = monthView(previous);
    expect(august.overallBudget).toBeNull();
    expect(august.categoryBudgets).toEqual([]);

    expect(monthView(SEPTEMBER).overallBudget?.spentMinor).toBe(rupees(19_500));
  });

  it('keeps a future month viewable, with the plan set and nothing spent yet', () => {
    const october = stepPeriodMonth(SEPTEMBER, 1);
    budgetService.createBudget({ periodMonth: october, amountMinor: rupees(30_000) });

    const view = monthView(october);
    expect(view.overallBudget?.budget.amountMinor).toBe(rupees(30_000));
    expect(view.overallBudget?.spentMinor).toBe(0);
    expect(getBudgetStatusLabel(view.overallBudget!)).toBe('No spending yet');
  });

  it('moves a backdated expense into the month it belongs to and out of this one', () => {
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(2_000),
      title: 'Last month',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 7, 20),
    });

    // September is unchanged; August is where the expense landed.
    expect(monthView(SEPTEMBER).overallBudget?.spentMinor).toBe(rupees(19_500));
    budgetService.createBudget({ periodMonth: AUGUST, amountMinor: rupees(10_000) });
    expect(monthView(AUGUST).overallBudget?.spentMinor).toBe(rupees(2_000));
  });
});

describe('budget writes leave the accounting alone', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    createSeptemberActivity(fixture);
  });
  afterAll(() => closeTestDatabase());

  /** Every figure a budget must never move. */
  function accounting() {
    return {
      totalBalance: getTotalBalance(),
      cash: getAccountBalance(fixture.cash.id),
      bank: getAccountBalance(fixture.bank.id),
      month: getReportSummary(getMonthRange(2026, 8)),
      transactions: transactionService.listTransactionViews().length,
    };
  }

  it('creates a budget without creating a transaction or moving a balance', () => {
    const before = accounting();
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    expect(accounting()).toEqual(before);
    expect(monthView(SEPTEMBER).categoryBudgets[0]?.budget.id).toBe(budget.id);
    // Offline or online, the write is local first and queued for upload.
    expect(getPendingSyncMutation('budget', budget.syncId!)?.operation).toBe('upsert');
  });

  it('changes the plan when the amount is edited, and nothing that was spent', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    const before = accounting();

    budgetService.updateBudget(budget.id, { amountMinor: rupees(20_000) });
    const food = monthView(SEPTEMBER).categoryBudgets[0]!;

    expect(food.spentMinor).toBe(rupees(9_000));
    expect(food.remainingMinor).toBe(rupees(11_000));
    expect(formatBudgetPercentage(food.percentage)).toBe('45%');
    expect(accounting()).toEqual(before);
  });

  it('removes a budget without removing a single expense', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    const before = accounting();

    budgetService.deleteBudget(budget.id);

    expect(monthView(SEPTEMBER).categoryBudgets).toEqual([]);
    expect(accounting()).toEqual(before);
    // The month's spending is still there; only the plan against it is gone.
    expect(getReportSummary(getMonthRange(2026, 8)).expenseMinor).toBe(rupees(19_500));
    // The plan was created and removed before the cloud ever saw it, so the
    // queued upload is withdrawn rather than followed by a tombstone. Either
    // way the screen's job is done: it called the service and knows nothing
    // about outboxes.
    expect(getPendingSyncMutation('budget', budget.syncId!)).toBeNull();
  });

  it('leaves budgets untouched when money moves in any way that is not spending', () => {
    createSeptemberBudgets(fixture);
    const before = monthView(SEPTEMBER);

    transactionService.createIncome({
      accountId: fixture.bank.id,
      categoryId: fixture.salary.id,
      amountMinor: rupees(50_000),
      title: 'Bonus',
      transactionDate: new Date(2026, 8, 22),
    });
    transactionService.createTransfer({
      sourceAccountId: fixture.bank.id,
      destinationAccountId: fixture.cash.id,
      amountMinor: rupees(10_000),
      transactionDate: new Date(2026, 8, 22),
    });
    transactionService.createLend({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(4_000),
      transactionDate: new Date(2026, 8, 23),
    });
    transactionService.createBorrow({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(3_000),
      transactionDate: new Date(2026, 8, 23),
    });
    transactionService.createRepaymentReceived({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(1_000),
      transactionDate: new Date(2026, 8, 24),
    });
    transactionService.createRepaymentPaid({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(500),
      transactionDate: new Date(2026, 8, 24),
    });

    const after = monthView(SEPTEMBER);
    expect(after.totalSpentMinor).toBe(before.totalSpentMinor);
    expect(after.overallBudget?.spentMinor).toBe(before.overallBudget?.spentMinor);
    expect(after.categoryBudgets.map((item) => item.spentMinor)).toEqual(
      before.categoryBudgets.map((item) => item.spentMinor),
    );
  });
});

describe('budgets with no network', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  /**
   * There is no cloud in this database, which is the offline case exactly: every
   * write goes to local SQLite and is queued for whenever an upload becomes
   * possible. Nothing about a budget screen waits on a network, so none of these
   * can produce a network error to show.
   */
  it('creates, edits and deletes with the result visible immediately', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    expect(monthView(SEPTEMBER).categoryBudgets[0]?.budget.amountMinor).toBe(rupees(15_000));
    expect(countPendingSyncMutations()).toBeGreaterThan(0);

    budgetService.updateBudget(budget.id, { amountMinor: rupees(20_000) });
    expect(monthView(SEPTEMBER).categoryBudgets[0]?.budget.amountMinor).toBe(rupees(20_000));

    budgetService.deleteBudget(budget.id);
    expect(monthView(SEPTEMBER).categoryBudgets).toEqual([]);
  });

  it('counts an unsent budget as a change the sync status should report', () => {
    const before = countPendingSyncMutations();
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    // A pending budget is ordinary pending work, which is what makes the app's
    // one global "pending changes" state include it without any budget-specific
    // cloud UI existing at all.
    expect(countPendingSyncMutations()).toBe(before + 1);
  });
});

describe('budget form rules', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('refuses a second budget for the same category and month', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.food.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(9_000),
      }),
    ).toThrow(ConflictError);
    expect(monthView(SEPTEMBER).categoryBudgets).toHaveLength(1);
  });

  it('refuses a second overall budget for the same month', () => {
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });

    expect(() =>
      budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(50_000) }),
    ).toThrow(ConflictError);
    expect(monthView(SEPTEMBER).overallBudget?.budget.amountMinor).toBe(rupees(40_000));
  });

  it('refuses an income category, which the picker never offers in the first place', () => {
    // The selector is built from expense categories only.
    const offered = categoryRepository.getExpenseCategories().map((category) => category.id);
    expect(offered).not.toContain(fixture.salary.id);

    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.salary.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(10_000),
      }),
    ).toThrow(ValidationError);
  });

  it('keeps a historical budget identifiable after its category is deleted elsewhere', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    applyRemoteTombstone({
      entityType: 'category',
      syncId: fixture.food.syncId!,
      deletedAt: new Date(),
    });

    const row = monthView(SEPTEMBER).categoryBudgets[0];
    expect(row?.budget.id).toBe(budget.id);
    // The row still stands and stays identifiable. The left join deliberately
    // ignores the category's tombstone, so the name a person recognises survives
    // the category being deleted — a budget is a record of what was planned, and
    // erasing what it was planned for would destroy that record.
    expect(row?.budget.categoryId).toBe(fixture.food.id);
    expect(categoryLabel(row!)).toBe('Food');
    // A deleted category is no longer offered for a new budget.
    expect(categoryRepository.getExpenseCategories().map((item) => item.id)).not.toContain(
      fixture.food.id,
    );
    // Its amount is still correctable even though the category has gone.
    expect(() =>
      budgetService.updateBudget(budget.id, { amountMinor: rupees(12_000) }),
    ).not.toThrow();
  });

  it('counts only spending in its own currency, and converts nothing', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
      currency: 'NPR',
    });
    transactionService.createExpense({
      accountId: fixture.dollars.id,
      categoryId: fixture.food.id,
      amountMinor: 100_00,
      title: 'Dollar dinner',
      paymentMode: 'debit_card',
      transactionDate: new Date(2026, 8, 9),
    });

    // The NPR plan is unmoved by a USD expense; the two are different quantities.
    expect(monthView(SEPTEMBER).categoryBudgets[0]?.spentMinor).toBe(0);
  });

  it('opens on the current calendar month rather than the month holding a budget', () => {
    budgetService.createBudget({ periodMonth: '2020-01', amountMinor: rupees(1_000) });
    const now = new Date();
    const range = getCurrentMonthRange(now);
    expect(range.start.getMonth()).toBe(now.getMonth());
    // What the screen opens on is `currentPeriodMonth`, which is today's month.
    expect(budgetService.listBudgetsForMonth(now)).toEqual([]);
  });
});
