import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as budgetService from '@/features/budgets/budget.service';
import * as recurring from '@/features/recurring/recurring.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import * as transactionService from '@/features/transactions/transaction.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import {
  buildRecurringFixture,
  createGroceryRun,
  createSalary,
  rupees,
  type RecurringFixture,
} from './fixture';

/**
 * Where the two M8 features meet.
 *
 * A recurring template is a plan and a budget is a plan, and neither is money.
 * Exactly one thing in this milestone moves a figure: an ordinary transaction
 * that generation happened to write. These tests hold the line at that seam —
 * a plan that has not been generated contributes nothing, a generated one
 * contributes once, and editing either side afterwards moves what it should and
 * nothing else.
 */

const AS_OF = '2026-09-12';

let fixture: RecurringFixture;

function foodBudget(periodMonth: string): number {
  return budgetService.createBudget({
    categoryId: fixture.food.id,
    periodMonth,
    amountMinor: rupees(15_000),
  }).id;
}

const spentOn = (id: number) => budgetService.getBudgetProgress(id).spentMinor;

describe('budgets and recurring templates', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('counts each month’s generated expense in its own month, once', () => {
    const template = createGroceryRun(fixture); // Food, 5,000, monthly from 2026-06-15.
    const june = foodBudget('2026-06');
    const july = foodBudget('2026-07');

    // A template alone is a plan. Nothing has been spent.
    expect(spentOn(june)).toBe(0);
    expect(spentOn(july)).toBe(0);

    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(spentOn(june)).toBe(rupees(5_000));
    expect(spentOn(july)).toBe(0);

    recurring.generateOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });
    // July gets its own occurrence; June is unchanged by it.
    expect(spentOn(june)).toBe(rupees(5_000));
    expect(spentOn(july)).toBe(rupees(5_000));
  });

  it('generating twice moves the budget once', () => {
    const template = createGroceryRun(fixture);
    const june = foodBudget('2026-06');

    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect(spentOn(june)).toBe(rupees(5_000));
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('puts a backdated generation in the month it was due, not the current one', () => {
    const template = createGroceryRun(fixture);
    const june = foodBudget('2026-06');
    const september = foodBudget('2026-09');

    // Generated in September, scheduled for June.
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect(spentOn(june)).toBe(rupees(5_000));
    expect(spentOn(september)).toBe(0);
  });

  it('keeps generated income out of budget spending entirely', () => {
    const salary = createSalary(fixture); // Income, 65,000 monthly.
    const overall = budgetService.createBudget({
      periodMonth: '2026-06',
      amountMinor: rupees(40_000),
    }).id;

    recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });

    // Income is money arriving. A spending plan has nothing to say about it.
    expect(spentOn(overall)).toBe(0);
    expect(budgetService.getBudgetProgress(overall).status).toBe('unused');
  });

  it('skipping a date moves no budget at all', () => {
    const template = createGroceryRun(fixture);
    const june = foodBudget('2026-06');

    recurring.skipOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect(spentOn(june)).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });
});

describe('editing a generated transaction', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });

  it('moves budget spending between categories without touching the template', () => {
    const template = createGroceryRun(fixture);
    const food = foodBudget('2026-06');
    const groceries = budgetService.createBudget({
      categoryId: fixture.groceries.id,
      periodMonth: '2026-06',
      amountMinor: rupees(15_000),
    }).id;
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    transactionService.updateExpense(generated.transactionId!, {
      categoryId: fixture.groceries.id,
    });

    expect(spentOn(food)).toBe(0);
    expect(spentOn(groceries)).toBe(rupees(5_000));
    // The plan for next month is untouched: one transaction was recategorised,
    // not the template that will write the next one.
    expect(recurring.getRecurringTemplate(template.id).categoryId).toBe(fixture.food.id);
  });

  it('removes the budget effect when the generated expense is deleted, and never regenerates', () => {
    const template = createGroceryRun(fixture);
    const june = foodBudget('2026-06');
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(spentOn(june)).toBe(rupees(5_000));

    transactionService.deleteTransaction(generated.transactionId!);

    expect(spentOn(june)).toBe(0);
    // The date stays handled: the decision to record it was made, and undoing
    // the record is not a reason to ask again.
    const due = recurring.listDueOccurrences({ asOfDate: AS_OF }).occurrences;
    expect(due.map((item) => item.occurrenceDate)).not.toContain('2026-06-15');
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  /**
   * The distinction M8E §112 insists on: an occurrence says *scheduled for*, a
   * transaction says *recorded for*. Moving the second must not rewrite the
   * first, or the template would silently acquire a date it never had — and the
   * date it did have would become due all over again.
   */
  it('moves the money to a new month while the occurrence keeps its scheduled date', () => {
    const template = createGroceryRun(fixture);
    const june = foodBudget('2026-06');
    const july = foodBudget('2026-07');
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    transactionService.updateExpense(generated.transactionId!, {
      transactionDate: new Date(2026, 6, 20, 12),
    });

    // The money moved to July.
    expect(spentOn(june)).toBe(0);
    expect(spentOn(july)).toBe(rupees(5_000));

    // The provenance did not. June 15 is still the date this was scheduled for.
    const provenance = recurring.getRecurringProvenance(generated.occurrence.id);
    expect(provenance?.occurrenceDate).toBe('2026-06-15');
    expect(recurring.listTemplateHistory(template.id)[0]?.occurrenceDate).toBe('2026-06-15');

    // And June 15 does not become due again just because nothing is dated to it.
    const due = recurring.listDueOccurrences({ asOfDate: AS_OF }).occurrences;
    expect(due.map((item) => item.occurrenceDate)).not.toContain('2026-06-15');
    expect(verifySyncIntegrity().issues).toEqual([]);
  });
});

describe('manual transactions', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });

  it('never acquire recurring provenance they did not come from', () => {
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    // Same category, same account, same amount, same day as a generated one.
    const manual = transactionService.createExpense({
      accountId: fixture.bank.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(5_000),
      title: 'Food box',
      transactionDate: new Date(2026, 5, 15, 12),
    });

    expect(manual.recurringOccurrenceId).toBeNull();
    expect(recurring.getRecurringProvenance(manual.id)).toBeNull();

    // Both count towards the budget, because both are real spending.
    const june = foodBudget('2026-06');
    expect(spentOn(june)).toBe(rupees(10_000));
    expect(verifySyncIntegrity().issues).toEqual([]);
  });
});
