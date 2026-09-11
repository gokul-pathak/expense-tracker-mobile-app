import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { formatBudgetPercentage } from '@/features/budgets/budget-presentation';
import { periodMonthsInRange } from '@/features/budgets/budget.period';
import { getBudgetComparisonForMonths } from '@/features/budgets/budget.reporting';
import * as budgetService from '@/features/budgets/budget.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import * as transactionService from '@/features/transactions/transaction.service';
import { getCustomRange, getMonthRange } from '@/utils/date-range';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

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
 * Budget against actual, inside Reports.
 *
 * The rule this file exists to hold is that a monthly budget stays monthly. A
 * report over a week, or over the 5th to the 22nd, gets no budget comparison at
 * all — not a seventh of one. A prorated limit would be a number the user never
 * set, printed with the same authority as one they did.
 *
 * The second rule is that adding this section changed no report figure. Income,
 * expense and savings are a record of what happened, and a plan is not part of
 * that record.
 */

const SEPTEMBER_RANGE = getMonthRange(2026, 8);
const JULY = '2026-07';
let fixture: BudgetFixture;

describe('which periods a budget can be compared against', () => {
  it('accepts a period that covers whole calendar months', () => {
    expect(periodMonthsInRange(getMonthRange(2026, 8))).toEqual([SEPTEMBER]);
    expect(periodMonthsInRange({ start: new Date(2026, 6, 1), end: new Date(2026, 9, 1) })).toEqual(
      [JULY, AUGUST, SEPTEMBER],
    );
  });

  it('rolls a year end without a table of month lengths', () => {
    expect(
      periodMonthsInRange({ start: new Date(2026, 11, 1), end: new Date(2027, 1, 1) }),
    ).toEqual(['2026-12', '2027-01']);
  });

  it('refuses a week, however it falls', () => {
    const week = getReportRange('this_week', new Date(2026, 8, 17));
    expect(periodMonthsInRange(week)).toBeNull();
    // Even a week that starts on the first of a month is still seven days.
    expect(
      periodMonthsInRange({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 8) }),
    ).toBeNull();
  });

  it('refuses a custom range that stops part way through a month', () => {
    expect(periodMonthsInRange(getCustomRange(new Date(2026, 8, 5), new Date(2026, 8, 22)))).toBe(
      null,
    );
    // A range that begins on the first but ends mid-month is still partial.
    expect(
      periodMonthsInRange({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 20) }),
    ).toBeNull();
    // So is one carrying a time of day, which is what a date picker produces.
    expect(
      periodMonthsInRange({ start: new Date(2026, 8, 1, 9, 30), end: new Date(2026, 9, 1) }),
    ).toBeNull();
  });

  it('accepts the month-aligned presets and refuses the rest', () => {
    const now = new Date(2026, 8, 17);
    for (const preset of [
      'this_month',
      'last_month',
      'last_3_months',
      'last_6_months',
      'this_year',
    ] as const) {
      expect(periodMonthsInRange(getReportRange(preset, now))).not.toBeNull();
    }
    expect(periodMonthsInRange(getReportRange('this_week', now))).toBeNull();
  });
});

describe('monthly budget comparison', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
  });
  afterAll(() => closeTestDatabase());

  it('compares one month against its overall budget', () => {
    createSeptemberBudgets(fixture);
    createSeptemberActivity(fixture);

    const [september] = getBudgetComparisonForMonths([SEPTEMBER]);
    expect(september?.budgetedMinor).toBe(rupees(40_000));
    expect(september?.source).toBe('overall');
    expect(september?.spentMinor).toBe(rupees(19_500));
    expect(september?.remainingMinor).toBe(rupees(20_500));
    expect(formatBudgetPercentage(september!.percentage!)).toBe('48.75%');
    expect(september?.status).toBe('within_budget');
  });

  it('says a month has no budget rather than showing a budget of zero', () => {
    createSeptemberActivity(fixture);

    const [september] = getBudgetComparisonForMonths([SEPTEMBER]);
    expect(september?.budgetedMinor).toBeNull();
    expect(september?.source).toBe('none');
    expect(september?.remainingMinor).toBeNull();
    expect(september?.percentage).toBeNull();
    expect(september?.status).toBeNull();
    // What was spent is still a fact worth reporting.
    expect(september?.spentMinor).toBe(rupees(19_500));
  });

  it('falls back to the category budgets only when there is no overall one', () => {
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
    createSeptemberActivity(fixture);

    const [september] = getBudgetComparisonForMonths([SEPTEMBER]);
    expect(september?.budgetedMinor).toBe(rupees(25_000));
    expect(september?.source).toBe('categories');
  });

  it('never adds an overall budget to the category budgets under it', () => {
    createSeptemberBudgets(fixture);

    const [september] = getBudgetComparisonForMonths([SEPTEMBER]);
    // 40,000 — not 65,000. The overall plan already covers Food and Travel.
    expect(september?.budgetedMinor).toBe(rupees(40_000));
  });

  it('gives one row per month and never sums the limits across them', () => {
    budgetService.createBudget({ periodMonth: JULY, amountMinor: rupees(30_000) });
    budgetService.createBudget({ periodMonth: AUGUST, amountMinor: rupees(35_000) });
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    createSeptemberActivity(fixture);
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(2_000),
      title: 'August dinner',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 7, 20),
    });

    const rows = getBudgetComparisonForMonths([JULY, AUGUST, SEPTEMBER]);
    expect(rows.map((row) => row.month)).toEqual([JULY, AUGUST, SEPTEMBER]);
    expect(rows.map((row) => row.budgetedMinor)).toEqual([
      rupees(30_000),
      rupees(35_000),
      rupees(40_000),
    ]);
    expect(rows.map((row) => row.spentMinor)).toEqual([0, rupees(2_000), rupees(19_500)]);
  });

  it('puts each expense in the month it happened, at either edge', () => {
    for (const month of [AUGUST, SEPTEMBER]) {
      budgetService.createBudget({ periodMonth: month, amountMinor: rupees(10_000) });
    }
    // The last instant of August and the first of September.
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(1_000),
      title: 'Last of August',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 7, 31, 23, 59, 59, 999),
    });
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(2_000),
      title: 'First of September',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 8, 1, 0, 0, 0, 0),
    });

    const rows = getBudgetComparisonForMonths([AUGUST, SEPTEMBER]);
    expect(rows.map((row) => row.spentMinor)).toEqual([rupees(1_000), rupees(2_000)]);
  });

  it('counts only the currency the budget is in', () => {
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    transactionService.createExpense({
      accountId: fixture.dollars.id,
      categoryId: fixture.food.id,
      amountMinor: 500_00,
      title: 'Dollar spend',
      paymentMode: 'debit_card',
      transactionDate: new Date(2026, 8, 10),
    });

    expect(getBudgetComparisonForMonths([SEPTEMBER])[0]?.spentMinor).toBe(0);
    expect(getBudgetComparisonForMonths([SEPTEMBER], 'USD')[0]?.spentMinor).toBe(500_00);
  });

  it('asks for nothing when asked about nothing', () => {
    expect(getBudgetComparisonForMonths([])).toEqual([]);
  });

  it('costs the same number of queries for twelve months as for one', () => {
    const months: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const month = `2026-${String(index + 1).padStart(2, '0')}`;
      months.push(month);
      budgetService.createBudget({ periodMonth: month, amountMinor: rupees(10_000) });
    }
    createSeptemberActivity(fixture);

    const one = countStatements(() => getBudgetComparisonForMonths([SEPTEMBER]));
    const twelve = countStatements(() => getBudgetComparisonForMonths(months));

    expect(twelve.result).toHaveLength(12);
    expect(twelve.result[8]?.spentMinor).toBe(rupees(19_500));
    // The point of the batched read: a year costs what a month costs. A query
    // per month, or per budget, would make this number grow with the span.
    expect(twelve.statements).toBe(one.statements);
  });
});

/**
 * How many statements a call prepares.
 *
 * The absolute number is an implementation detail of the driver; what matters is
 * that it does not grow with the number of months asked about, so the tests
 * compare two counts rather than assert one.
 */
function countStatements<T>(run: () => T): { result: T; statements: number } {
  const client = rawClient() as unknown as {
    prepare: (sql: string) => unknown;
  };
  const original = client.prepare.bind(client);
  let statements = 0;
  client.prepare = (sql: string) => {
    statements += 1;
    return original(sql);
  };
  try {
    return { result: run(), statements };
  } finally {
    client.prepare = original;
  }
}

describe('reports figures are untouched by budgets', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildFixture();
    createSeptemberActivity(fixture);
  });
  afterAll(() => closeTestDatabase());

  it('leaves income, expense and savings exactly as they were', () => {
    const before = getReportSummary(SEPTEMBER_RANGE);
    expect(before.expenseMinor).toBe(rupees(19_500));

    const budgets = createSeptemberBudgets(fixture);
    expect(getReportSummary(SEPTEMBER_RANGE)).toEqual(before);

    budgetService.updateBudget(budgets.overall.id, { amountMinor: rupees(5_000) });
    expect(getReportSummary(SEPTEMBER_RANGE)).toEqual(before);

    budgetService.deleteBudget(budgets.food.id);
    expect(getReportSummary(SEPTEMBER_RANGE)).toEqual(before);
    // The report still records every rupee that was actually spent.
    expect(getReportSummary(SEPTEMBER_RANGE).expenseMinor).toBe(rupees(19_500));
  });

  it('reports the same spending the budget comparison does', () => {
    createSeptemberBudgets(fixture);
    const report = getReportSummary(SEPTEMBER_RANGE);
    const [september] = getBudgetComparisonForMonths([SEPTEMBER]);
    expect(september?.spentMinor).toBe(report.expenseMinor);
  });
});
