import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as budgetService from '@/features/budgets/budget.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

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
 * What happens to a budget when the records underneath it change.
 *
 * This is the whole reason spending is never stored. Every case below would need
 * its own correction if a `spent` column existed, and one missed correction
 * would leave a figure that is wrong in a way nothing reveals. Because spending
 * is a sum over transactions, none of them needs any code at all — these tests
 * exist to prove that stays true.
 */

let fixture: BudgetFixture;
let budgets: ReturnType<typeof createSeptemberBudgets>;

const foodSpent = () => budgetService.getBudgetProgress(budgets.food.id).spentMinor;
const travelSpent = () => budgetService.getBudgetProgress(budgets.travel.id).spentMinor;
const overallSpent = () => budgetService.getBudgetProgress(budgets.overall.id).spentMinor;

describe('transaction changes and budget spending', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    budgets = createSeptemberBudgets(fixture);
  });
  afterAll(() => closeTestDatabase());

  it('reflects an edited amount rather than adding to the old one', () => {
    const activity = createSeptemberActivity(fixture);
    expect(foodSpent()).toBe(rupees(9_000));

    // 5,000 becomes 8,000: Food is 12,000, not 17,000.
    transactionService.updateExpense(activity.foodA.id, { amountMinor: rupees(8_000) });

    expect(foodSpent()).toBe(rupees(12_000));
    expect(overallSpent()).toBe(rupees(22_500));
  });

  it('moves spending between categories when an expense changes category', () => {
    createSeptemberActivity(fixture);
    const shopping = transactionService
      .listTransactions()
      .find((item) => item.categoryId === fixture.shopping.id)!;

    transactionService.updateExpense(shopping.id, { categoryId: fixture.food.id });

    // 3,000 leaves Shopping and joins Food. The month total is unchanged,
    // because the money was always spent.
    expect(foodSpent()).toBe(rupees(12_000));
    expect(travelSpent()).toBe(rupees(7_500));
    expect(overallSpent()).toBe(rupees(19_500));
  });

  it('moves spending between months when a financial date changes', () => {
    const august = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: AUGUST,
      amountMinor: rupees(15_000),
    });
    const activity = createSeptemberActivity(fixture);
    expect(foodSpent()).toBe(rupees(9_000));

    // September 3 becomes August 30.
    transactionService.updateExpense(activity.foodA.id, {
      transactionDate: new Date(2026, 7, 30),
    });

    expect(foodSpent()).toBe(rupees(4_000));
    expect(budgetService.getBudgetProgress(august.id).spentMinor).toBe(rupees(5_000));
    expect(overallSpent()).toBe(rupees(14_500));
  });

  it('leaves budgets alone when only the funding account changes', () => {
    const activity = createSeptemberActivity(fixture);

    transactionService.updateExpense(activity.foodA.id, { accountId: fixture.bank.id });

    // A budget measures spending, not which account it came out of.
    expect(foodSpent()).toBe(rupees(9_000));
    expect(overallSpent()).toBe(rupees(19_500));
  });

  it('removes a deleted expense from every budget it counted towards', () => {
    const activity = createSeptemberActivity(fixture);

    transactionService.deleteTransaction(activity.travel.id);

    expect(travelSpent()).toBe(0);
    expect(budgetService.getBudgetProgress(budgets.travel.id).status).toBe('unused');
    expect(overallSpent()).toBe(rupees(12_000));
  });

  it('puts a backdated expense in the month it was spent, not the month it was entered', () => {
    const august = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: AUGUST,
      amountMinor: rupees(15_000),
    });
    createSeptemberActivity(fixture);
    const balanceBefore = getAccountBalance(fixture.cash.id);

    // Entered now, spent on August 31.
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(4_000),
      title: 'Backdated groceries',
      transactionDate: new Date(2026, 7, 31),
    });

    expect(budgetService.getBudgetProgress(august.id).spentMinor).toBe(rupees(4_000));
    expect(foodSpent()).toBe(rupees(9_000));
    expect(overallSpent()).toBe(rupees(19_500));
    // The money still left the account, whichever month it belongs to.
    expect(getAccountBalance(fixture.cash.id)).toBe(balanceBefore - rupees(4_000));
  });
});

describe('only expenses count towards a budget', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    budgets = createSeptemberBudgets(fixture);
  });
  afterAll(() => closeTestDatabase());

  it('ignores income, transfers, lending, borrowing and repayments', () => {
    // The four expenses and all six other records land in the same month.
    createSeptemberActivity(fixture);

    // 65,000 income, 20,000 transferred, 8,000 lent, 5,000 borrowed, 2,000
    // repaid to us and 1,000 repaid by us — none of it is spending.
    expect(overallSpent()).toBe(rupees(19_500));
    expect(foodSpent()).toBe(rupees(9_000));
    expect(travelSpent()).toBe(rupees(7_500));
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER).totalSpentMinor).toBe(rupees(19_500));
  });

  it('stays at zero for a month holding nothing but non-expense records', () => {
    transactionService.createIncome({
      accountId: fixture.bank.id,
      categoryId: fixture.salary.id,
      amountMinor: rupees(65_000),
      title: 'Salary',
      transactionDate: new Date(2026, 8, 1),
    });
    transactionService.createTransfer({
      sourceAccountId: fixture.bank.id,
      destinationAccountId: fixture.cash.id,
      amountMinor: rupees(20_000),
      transactionDate: new Date(2026, 8, 2),
    });
    transactionService.createLend({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(8_000),
      transactionDate: new Date(2026, 8, 5),
    });
    transactionService.createBorrow({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(5_000),
      transactionDate: new Date(2026, 8, 6),
    });
    transactionService.createRepaymentReceived({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(2_000),
      transactionDate: new Date(2026, 8, 20),
    });
    transactionService.createRepaymentPaid({
      personId: fixture.person.id,
      accountId: fixture.cash.id,
      amountMinor: rupees(1_000),
      transactionDate: new Date(2026, 8, 21),
    });

    expect(overallSpent()).toBe(0);
    expect(budgetService.getBudgetProgress(budgets.overall.id).status).toBe('unused');
  });
});
