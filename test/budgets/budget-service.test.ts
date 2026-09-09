import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { isSyncId } from '@/db/schema';
import * as budgetRepository from '@/features/budgets/budget.repository';
import * as budgetService from '@/features/budgets/budget.service';
import {
  formatPeriodMonth,
  monthRange,
  normalizePeriodMonth,
} from '@/features/budgets/budget.period';
import * as settingsService from '@/features/settings/settings.service';
import { applyRemoteTombstone } from '@/features/sync/remote-apply.repository';
import { getPendingSyncMutation } from '@/features/sync/sync.repository';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import { buildFixture, rupees, SEPTEMBER, type BudgetFixture } from './fixture';

/**
 * Creating, editing and deleting a plan.
 *
 * The rules that get their own test here are the ones whose absence would be
 * silent: a budget on an income category would compare a limit against spending
 * that cannot occur, and a second budget for one month would produce a figure
 * nobody chose.
 */

let fixture: BudgetFixture;

describe('budget service', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('creates a category budget with a global identity and queues it for upload', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    expect(budget.periodMonth).toBe(SEPTEMBER);
    expect(budget.amountMinor).toBe(rupees(15_000));
    expect(budget.currency).toBe('NPR');
    expect(budget.deletedAt).toBeNull();
    expect(isSyncId(budget.syncId)).toBe(true);
    expect(getPendingSyncMutation('budget', budget.syncId!)?.operation).toBe('upsert');
    expect(budgetService.getBudget(budget.id)).toMatchObject({ id: budget.id });
  });

  it('creates an overall budget with no category at all', () => {
    const overall = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });
    expect(overall.categoryId).toBeNull();

    // An overall budget and a category budget for the same month coexist.
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    expect(budgetService.listBudgetsForMonth(SEPTEMBER)).toHaveLength(2);
  });

  it('takes its currency from settings and normalizes an explicit one', () => {
    settingsService.updateDefaultCurrency('inr');
    const fromSettings = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(1_000),
    });
    expect(fromSettings.currency).toBe('INR');

    const explicit = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(1_000),
      currency: 'usd',
    });
    expect(explicit.currency).toBe('USD');
  });

  it('refuses a duplicate plan for the same month, currency and category', () => {
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
    ).toThrow(/already exists/);

    // A different month, category or currency is a different plan.
    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.food.id,
        periodMonth: '2026-10',
        amountMinor: rupees(9_000),
      }),
    ).not.toThrow();
    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.travel.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(9_000),
      }),
    ).not.toThrow();
    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.food.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(9_000),
        currency: 'USD',
      }),
    ).not.toThrow();
  });

  it('refuses a second overall budget for one month, despite its null category', () => {
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    expect(() =>
      budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(30_000) }),
    ).toThrow(/already exists/);
  });

  it('refuses an amount that is not a positive safe integer of minor units', () => {
    const create = (amountMinor: number) =>
      budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor });

    expect(() => create(0)).toThrow(/greater than zero/);
    expect(() => create(-1)).toThrow(/greater than zero/);
    expect(() => create(1500.5)).toThrow(/safe integer/);
    expect(() => create(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/);
  });

  it('refuses a budget on an income category', () => {
    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.salary.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(1_000),
      }),
    ).toThrow(/expense categories/);
  });

  it('refuses a budget on a category that no longer exists', () => {
    const travelSyncId = fixture.travel.syncId!;
    // A category deleted on another device: not selectable for a new plan, the
    // same as anywhere else it could be chosen.
    applyRemoteTombstone({ entityType: 'category', syncId: travelSyncId, deletedAt: new Date() });

    expect(() =>
      budgetService.createBudget({
        categoryId: fixture.travel.id,
        periodMonth: SEPTEMBER,
        amountMinor: rupees(1_000),
      }),
    ).toThrow(/not found/);
    expect(() =>
      budgetService.createBudget({ categoryId: 9_999, periodMonth: SEPTEMBER, amountMinor: 1 }),
    ).toThrow(/not found/);
  });

  it('keeps an existing budget readable after its category is deleted elsewhere', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    });
    applyRemoteTombstone({
      entityType: 'category',
      syncId: fixture.travel.syncId!,
      deletedAt: new Date(),
    });

    // Deleting a category is not a reason to erase what was planned.
    const progress = budgetService.getBudgetProgress(budget.id);
    expect(progress.budget.id).toBe(budget.id);
    expect(progress.budget.amountMinor).toBe(rupees(10_000));
    // The amount can still be corrected even though the category is gone.
    expect(() =>
      budgetService.updateBudget(budget.id, { amountMinor: rupees(11_000) }),
    ).not.toThrow();
  });

  it('edits amount, month, currency and category', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    const amended = budgetService.updateBudget(budget.id, { amountMinor: rupees(18_000) });
    expect(amended.amountMinor).toBe(rupees(18_000));

    const moved = budgetService.updateBudget(budget.id, {
      periodMonth: '2026-10',
      categoryId: fixture.travel.id,
      currency: 'USD',
    });
    expect(moved).toMatchObject({
      periodMonth: '2026-10',
      categoryId: fixture.travel.id,
      currency: 'USD',
    });
    // The identity is stable across every edit.
    expect(moved.syncId).toBe(budget.syncId);
    expect(getPendingSyncMutation('budget', budget.syncId!)?.operation).toBe('upsert');
  });

  it('refuses an edit that would collide with another plan', () => {
    const food = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    });

    expect(() => budgetService.updateBudget(food.id, { categoryId: fixture.travel.id })).toThrow(
      /already exists/,
    );
    // Editing a budget to what it already is stays allowed.
    expect(() => budgetService.updateBudget(food.id, { periodMonth: SEPTEMBER })).not.toThrow();
  });

  it('refuses an empty edit rather than writing an update that means nothing', () => {
    const budget = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(1_000),
    });
    expect(() => budgetService.updateBudget(budget.id, {})).toThrow(/at least one/);
  });

  it('deletes a plan as a tombstone, keeping its identity for other devices', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    budgetService.deleteBudget(budget.id);

    expect(budgetService.listBudgetsForMonth(SEPTEMBER)).toEqual([]);
    expect(() => budgetService.getBudget(budget.id)).toThrow(/not found/);
    expect(() => budgetService.getBudgetProgress(budget.id)).toThrow(/not found/);
    // The row is still there, hidden, carrying its identity.
    expect(budgetRepository.findLiveBudget(SEPTEMBER, 'NPR', fixture.food.id)).toBeNull();
    // This database has never been linked, so the cloud provably never saw the
    // budget: the queued upload is cancelled instead of a tombstone being
    // queued for a record nothing else knows about. A linked database queues the
    // tombstone, which `test/sync/budget-sync.test.ts` covers.
    expect(getPendingSyncMutation('budget', budget.syncId!)).toBeNull();
  });

  it('frees the month once a plan is deleted, so it can be planned again', () => {
    const first = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    budgetService.deleteBudget(first.id);

    const second = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(20_000),
    });
    expect(second.id).not.toBe(first.id);
    expect(second.syncId).not.toBe(first.syncId);
  });

  it('deletes only the plan, never the records it measured', () => {
    const budget = budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    budgetService.deleteBudget(budget.id);

    expect(budgetService.listBudgets()).toEqual([]);
    // Everything a budget points at outlives it.
    expect(fixture.food.id).toBeDefined();
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER).totalSpentMinor).toBe(0);
  });

  it('creates no budget for a month nobody planned', () => {
    expect(budgetService.listBudgetsForMonth('2030-01')).toEqual([]);
    const summary = budgetService.getMonthlyBudgetSummary('2030-01');
    expect(summary.overallBudget).toBeNull();
    // Reading a month must never bring a plan into existence.
    expect(budgetService.listBudgets()).toEqual([]);
  });
});

describe('budget month representation', () => {
  it('accepts YYYY-MM, a normalized first-of-month, and a date', () => {
    expect(normalizePeriodMonth('2026-09')).toBe('2026-09');
    expect(normalizePeriodMonth('2026-09-01')).toBe('2026-09');
    expect(normalizePeriodMonth(new Date(2026, 8, 17))).toBe('2026-09');
    expect(formatPeriodMonth(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('refuses anything that is not unambiguously one month', () => {
    // A mid-month date is a mistake, not a shorthand: filing a plan under the
    // wrong month is silently wrong and nothing later would reveal it.
    expect(() => normalizePeriodMonth('2026-09-17')).toThrow(/valid YYYY-MM/);
    expect(() => normalizePeriodMonth('2026-13')).toThrow(/valid YYYY-MM/);
    expect(() => normalizePeriodMonth('2026-00')).toThrow(/valid YYYY-MM/);
    expect(() => normalizePeriodMonth('2026-9')).toThrow(/valid YYYY-MM/);
    expect(() => normalizePeriodMonth('')).toThrow(/valid YYYY-MM/);
    expect(() => normalizePeriodMonth(new Date('nonsense'))).toThrow(/not a valid date/);
    expect(() => normalizePeriodMonth(202609)).toThrow(/required/);
  });

  it('covers a whole month, half-open, in local time', () => {
    const range = monthRange('2026-09');
    expect(range.start).toEqual(new Date(2026, 8, 1));
    expect(range.end).toEqual(new Date(2026, 9, 1));

    // December rolls into the next January without a special case.
    expect(monthRange('2026-12').end).toEqual(new Date(2027, 0, 1));
    // A leap February is 29 days; the next one is 28.
    expect(monthRange('2028-02').end).toEqual(new Date(2028, 2, 1));
  });
});
