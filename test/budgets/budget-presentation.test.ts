import { describe, expect, it } from 'vitest';

import {
  budgetName,
  categoryLabel,
  currentPeriodMonth,
  describeBudgetConflict,
  formatBudgetPercentage,
  formatBudgetPercentageCompact,
  getBudgetAccessibilityLabel,
  getBudgetProgressAccessibilityLabel,
  getBudgetRemainderLabel,
  getBudgetSpendLabel,
  getMonthLabel,
  getShortMonthLabel,
  pickBudgetHighlights,
  sortBudgetProgress,
  stepPeriodMonth,
} from '@/features/budgets/budget-presentation';
import { budgetStatusOf } from '@/features/budgets/budget.progress';
import type { Budget, BudgetProgress } from '@/features/budgets/budget.types';

/**
 * What the budget screens say, tested without a screen.
 *
 * The runner collects `.ts` only, so a React component is out of reach here.
 * That is exactly why every rule about wording, ordering and rounding lives in a
 * plain module: the sentence a person reads is the thing worth asserting, and it
 * is asserted here rather than inferred from a rendered tree.
 */

const rupees = (amount: number) => amount * 100;

function progress(
  options: {
    id?: number;
    categoryId?: number | null;
    categoryName?: string | null;
    amountMinor?: number;
    spentMinor?: number;
    currency?: string;
  } = {},
): BudgetProgress {
  const amountMinor = options.amountMinor ?? rupees(15_000);
  const spentMinor = options.spentMinor ?? 0;
  const remainingMinor = amountMinor - spentMinor;
  const budget = {
    id: options.id ?? 1,
    categoryId: options.categoryId === undefined ? 7 : options.categoryId,
    periodMonth: '2026-09',
    amountMinor,
    currency: options.currency ?? 'NPR',
  } as unknown as Budget;

  return {
    budget,
    categoryName: options.categoryName === undefined ? 'Food' : options.categoryName,
    categoryIcon: null,
    spentMinor,
    remainingMinor,
    overspentMinor: Math.max(0, -remainingMinor),
    percentage: (spentMinor / amountMinor) * 100,
    status: budgetStatusOf(spentMinor, amountMinor),
  };
}

describe('budget percentages', () => {
  it('keeps whole percentages whole and never caps an overspend', () => {
    expect(formatBudgetPercentage(60)).toBe('60%');
    expect(formatBudgetPercentage(75)).toBe('75%');
    expect(formatBudgetPercentage(100)).toBe('100%');
    // The bar stops at the marker. The number beside it does not.
    expect(formatBudgetPercentage(125)).toBe('125%');
  });

  it('shows the true fraction rather than a sixteen-digit float', () => {
    // 19,500 of 40,000, and 17,000 of 15,000 — the milestone's own figures.
    expect(formatBudgetPercentage((19_500 / 40_000) * 100)).toBe('48.75%');
    expect(formatBudgetPercentage((17_000 / 15_000) * 100)).toBe('113.33%');
    expect(formatBudgetPercentage(113.33333333333333)).not.toContain('3333333');
  });

  it('has a whole-number form for places with no room for decimals', () => {
    expect(formatBudgetPercentageCompact(48.75)).toBe('49%');
    expect(formatBudgetPercentageCompact(113.33)).toBe('113%');
  });

  it('does not print a number for a ratio that is not one', () => {
    expect(formatBudgetPercentage(Number.NaN)).toBe('—');
    expect(formatBudgetPercentage(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('budget wording', () => {
  it('states an overspend as an overspend, never as a negative remainder', () => {
    const over = progress({ amountMinor: rupees(15_000), spentMinor: rupees(17_000) });
    expect(getBudgetRemainderLabel(over)).toBe('NPR 2,000.00 over budget');
    expect(getBudgetRemainderLabel(over)).not.toContain('remaining');
    expect(getBudgetRemainderLabel(over)).not.toContain('-');
  });

  it('calls spending exactly to the limit reaching it, not exceeding it', () => {
    const exact = progress({ amountMinor: rupees(15_000), spentMinor: rupees(15_000) });
    expect(exact.status).toBe('at_budget');
    expect(getBudgetRemainderLabel(exact)).toBe('Budget reached');
    expect(getBudgetRemainderLabel(exact)).not.toContain('over');
  });

  it('states what is left when there is room, spent or not', () => {
    const partway = progress({ amountMinor: rupees(15_000), spentMinor: rupees(9_000) });
    expect(getBudgetRemainderLabel(partway)).toBe('NPR 6,000.00 remaining');

    const untouched = progress({ amountMinor: rupees(10_000), spentMinor: 0 });
    expect(untouched.status).toBe('unused');
    expect(getBudgetRemainderLabel(untouched)).toBe('NPR 10,000.00 remaining');
  });

  it('drops the currency code where the screen has already named the currency', () => {
    const partway = progress({ amountMinor: rupees(15_000), spentMinor: rupees(9_000) });
    expect(getBudgetSpendLabel(partway, { code: false })).toBe('9,000.00 of 15,000.00');
    expect(getBudgetRemainderLabel(partway, { code: false })).toBe('6,000.00 remaining');
  });

  it('groups a large figure the way its currency does, and does not truncate it', () => {
    const large = progress({
      amountMinor: 99_999_999_99,
      spentMinor: 1_24_500_00,
      currency: 'NPR',
    });
    expect(getBudgetSpendLabel(large, { code: false })).toBe('1,24,500.00 of 9,99,99,999.99');
  });
});

describe('budget accessibility labels', () => {
  it('reads a row in full: what it covers, the plan, the gap and the share', () => {
    const partway = progress({ amountMinor: rupees(15_000), spentMinor: rupees(9_000) });
    expect(getBudgetAccessibilityLabel(partway)).toBe(
      'Food budget, NPR 9,000.00 of NPR 15,000.00 spent, NPR 6,000.00 remaining, 60% of budget spent.',
    );
  });

  it('reads an overspent row as over budget', () => {
    const over = progress({ amountMinor: rupees(15_000), spentMinor: rupees(17_000) });
    expect(getBudgetAccessibilityLabel(over)).toContain('NPR 2,000.00 over budget');
  });

  it('gives the progress indicator a value of its own, not only a width', () => {
    const partway = progress({ amountMinor: rupees(15_000), spentMinor: rupees(9_000) });
    expect(getBudgetProgressAccessibilityLabel(partway)).toBe('60% of budget spent');
  });

  it('names the overall plan without pretending it has a category', () => {
    const overall = progress({ categoryId: null, categoryName: null });
    expect(budgetName(overall)).toBe('Monthly budget');
    expect(categoryLabel(overall)).toBe('Everything');
  });

  it('keeps a budget whose category was deleted identifiable rather than blank', () => {
    // A left join returns no name once the category is tombstoned elsewhere.
    const orphan = progress({ categoryId: 7, categoryName: null });
    expect(categoryLabel(orphan)).toBe('Deleted category');
    expect(getBudgetAccessibilityLabel(orphan)).toContain('Deleted category budget');
  });
});

describe('budget ordering', () => {
  it('puts what is over budget first, then what is nearest to it', () => {
    const items = [
      progress({
        id: 1,
        categoryName: 'Travel',
        amountMinor: rupees(10_000),
        spentMinor: rupees(7_500),
      }),
      progress({
        id: 2,
        categoryName: 'Food',
        amountMinor: rupees(15_000),
        spentMinor: rupees(17_000),
      }),
      progress({ id: 3, categoryName: 'Bills', amountMinor: rupees(5_000), spentMinor: 0 }),
    ];
    expect(sortBudgetProgress(items).map((item) => item.categoryName)).toEqual([
      'Food',
      'Travel',
      'Bills',
    ]);
  });

  it('breaks a tie the same way every time, and leaves the input alone', () => {
    const items = [
      progress({
        id: 9,
        categoryName: 'Zakat',
        amountMinor: rupees(1_000),
        spentMinor: rupees(500),
      }),
      progress({
        id: 4,
        categoryName: 'Alms',
        amountMinor: rupees(2_000),
        spentMinor: rupees(1_000),
      }),
    ];
    const first = sortBudgetProgress(items).map((item) => item.budget.id);
    const second = sortBudgetProgress(items).map((item) => item.budget.id);
    expect(first).toEqual(second);
    expect(first).toEqual([4, 9]);
    expect(items.map((item) => item.budget.id)).toEqual([9, 4]);
  });

  it('gives Home the few that matter and no more', () => {
    const items = [
      progress({ id: 1, categoryName: 'A', amountMinor: rupees(100), spentMinor: rupees(10) }),
      progress({ id: 2, categoryName: 'B', amountMinor: rupees(100), spentMinor: rupees(90) }),
      progress({ id: 3, categoryName: 'C', amountMinor: rupees(100), spentMinor: rupees(150) }),
      progress({ id: 4, categoryName: 'D', amountMinor: rupees(100), spentMinor: rupees(50) }),
    ];
    expect(pickBudgetHighlights(items, 2).map((item) => item.categoryName)).toEqual(['C', 'B']);
    expect(pickBudgetHighlights(items)).toHaveLength(3);
    expect(pickBudgetHighlights(items, 0)).toEqual([]);
  });
});

describe('budget months', () => {
  it('steps through a year end without a table of month lengths', () => {
    expect(stepPeriodMonth('2026-12', 1)).toBe('2027-01');
    expect(stepPeriodMonth('2026-01', -1)).toBe('2025-12');
    expect(stepPeriodMonth('2026-09', 0)).toBe('2026-09');
    expect(stepPeriodMonth('2026-09', 12)).toBe('2027-09');
  });

  it('names a month for a person rather than for a database', () => {
    expect(getMonthLabel('2026-09')).toBe('September 2026');
    expect(getShortMonthLabel('2026-09')).toBe('September');
  });

  it('opens on the month the user is living in, not the latest one with a budget', () => {
    expect(currentPeriodMonth(new Date(2026, 8, 17))).toBe('2026-09');
    expect(currentPeriodMonth(new Date(2027, 0, 1))).toBe('2027-01');
  });
});

describe('duplicate budget wording', () => {
  it('names the overall budget that already exists and where to go', () => {
    expect(
      describeBudgetConflict('An overall NPR budget already exists for 2026-09.', {
        month: '2026-09',
        overall: true,
      }),
    ).toBe('An overall budget already exists for September. Edit that one instead.');
  });

  it('names the category budget that already exists', () => {
    expect(
      describeBudgetConflict('A NPR budget for that category already exists for 2026-09.', {
        month: '2026-09',
        overall: false,
        categoryName: 'Food',
      }),
    ).toBe('A Food budget already exists for September. Edit that one instead.');
  });

  it('passes an unrelated failure through untouched', () => {
    expect(
      describeBudgetConflict('Budget amount must be greater than zero.', {
        month: '2026-09',
        overall: false,
      }),
    ).toBe('Budget amount must be greater than zero.');
  });
});
