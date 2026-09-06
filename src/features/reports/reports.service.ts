import { ValidationError } from '@/features/shared/errors';
import {
  addLocalDays,
  getCurrentMonthRange,
  getCurrentWeekRange,
  getCurrentYearRange,
  getCustomRange as createCustomRange,
  getLastNMonthsRange,
  getPreviousMonthRange,
  getMonthRange,
  startOfLocalDay,
} from '@/utils/date-range';

import * as repository from './reports.repository';
import type {
  CategoryBreakdownItem,
  MonthlyComparison,
  ReportFilters,
  ReportGranularity,
  ReportInsight,
  ReportPreset,
  ReportRange,
  ReportSummary,
  TrendPoint,
} from './reports.types';

export function getReportRange(
  preset: Exclude<ReportPreset, 'custom'>,
  now = new Date(),
): ReportRange {
  switch (preset) {
    case 'this_week':
      return getCurrentWeekRange(now);
    case 'this_month':
    case 'last_1_month':
      return getCurrentMonthRange(now);
    case 'last_month':
      return getPreviousMonthRange(now);
    case 'last_3_months':
      return getLastNMonthsRange(3, now);
    case 'last_6_months':
      return getLastNMonthsRange(6, now);
    case 'this_year':
      return getCurrentYearRange(now);
  }
}

export function getCustomRange(start: Date, end: Date): ReportRange {
  try {
    return createCustomRange(start, end);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'Custom range is invalid.');
  }
}

export function getReportSummary(range: ReportRange, filters?: ReportFilters): ReportSummary {
  const totals = repository.getSummaryTotals(range, filters);
  const incomeMinor = assertSafeInteger(totals?.incomeMinor ?? 0, 'Income total');
  const expenseMinor = assertSafeInteger(totals?.expenseMinor ?? 0, 'Expense total');
  return {
    incomeMinor,
    expenseMinor,
    savingsMinor: assertSafeInteger(incomeMinor - expenseMinor, 'Savings'),
  };
}

export function getExpenseCategoryBreakdown(
  range: ReportRange,
  filters?: ReportFilters,
): CategoryBreakdownItem[] {
  return getCategoryBreakdown('expense', range, filters);
}

export function getIncomeCategoryBreakdown(
  range: ReportRange,
  filters?: ReportFilters,
): CategoryBreakdownItem[] {
  return getCategoryBreakdown('income', range, filters);
}

export function getIncomeExpenseTrend(
  range: ReportRange,
  granularity: ReportGranularity,
  options?: { filters?: ReportFilters; now?: Date },
): TrendPoint[] {
  const now = options?.now ?? new Date();
  const buckets = getBuckets(range, granularity, now);
  const values = new Map<number, { incomeMinor: number; expenseMinor: number }>();
  for (const row of repository.getDailyIncomeExpenseTotals(range, options?.filters)) {
    const date = row.transactionDate;
    const bucketStart = getBucketStart(date, granularity).getTime();
    const current = values.get(bucketStart) ?? { incomeMinor: 0, expenseMinor: 0 };
    const amountMinor = assertSafeInteger(row.amountMinor, 'Trend total');
    if (row.type === 'income') current.incomeMinor += amountMinor;
    if (row.type === 'expense') current.expenseMinor += amountMinor;
    values.set(bucketStart, current);
  }
  return buckets.map((bucket) => ({
    ...bucket,
    ...(values.get(bucket.start.getTime()) ?? { incomeMinor: 0, expenseMinor: 0 }),
  }));
}

export function getSpendingTrend(
  range: ReportRange,
  granularity: ReportGranularity,
  options?: { filters?: ReportFilters; now?: Date },
) {
  return getIncomeExpenseTrend(range, granularity, options).map(
    ({ incomeMinor: _incomeMinor, ...point }) => point,
  );
}

export function getRecommendedGranularity(preset: ReportPreset): ReportGranularity {
  if (preset === 'this_week') return 'day';
  if (preset === 'this_month' || preset === 'last_month' || preset === 'last_1_month') return 'day';
  return 'month';
}

export function getMonthlyComparison(options?: {
  now?: Date;
  filters?: ReportFilters;
}): MonthlyComparison {
  const now = options?.now ?? new Date();
  const currentExpenseMinor = getReportSummary(
    getCurrentMonthRange(now),
    options?.filters,
  ).expenseMinor;
  const previousExpenseMinor = getReportSummary(
    getPreviousMonthRange(now),
    options?.filters,
  ).expenseMinor;
  const differenceMinor = assertSafeInteger(
    currentExpenseMinor - previousExpenseMinor,
    'Expense difference',
  );
  return {
    currentExpenseMinor,
    previousExpenseMinor,
    differenceMinor,
    percentageChange:
      previousExpenseMinor === 0 ? null : (differenceMinor / previousExpenseMinor) * 100,
  };
}

export function getSimpleInsights(
  range: ReportRange,
  options?: { filters?: ReportFilters; now?: Date },
): ReportInsight[] {
  const summary = getReportSummary(range, options?.filters);
  const biggest = getExpenseCategoryBreakdown(range, options?.filters)[0];
  const insights: ReportInsight[] = [];
  if (biggest)
    insights.push({
      type: 'biggest_expense_category',
      categoryId: biggest.categoryId,
      categoryName: biggest.categoryName,
    });
  const comparison = getMonthlyComparison(options);
  if (comparison.percentageChange !== null && comparison.differenceMinor > 0)
    insights.push({
      type: 'expense_increase',
      percentage: comparison.percentageChange,
      differenceMinor: comparison.differenceMinor,
    });
  if (comparison.percentageChange !== null && comparison.differenceMinor < 0)
    insights.push({
      type: 'expense_decrease',
      percentage: comparison.percentageChange,
      differenceMinor: Math.abs(comparison.differenceMinor),
    });
  if (summary.savingsMinor > 0)
    insights.push({ type: 'savings', amountMinor: summary.savingsMinor });
  if (summary.savingsMinor < 0)
    insights.push({ type: 'expense_exceeded_income', amountMinor: Math.abs(summary.savingsMinor) });
  return insights.slice(0, 3);
}

function getCategoryBreakdown(
  type: 'income' | 'expense',
  range: ReportRange,
  filters?: ReportFilters,
) {
  const total =
    type === 'expense'
      ? getReportSummary(range, filters).expenseMinor
      : getReportSummary(range, filters).incomeMinor;
  return repository.getCategoryTotals(type, range, filters).map((item) => {
    const amountMinor = assertSafeInteger(item.amountMinor, 'Category total');
    return { ...item, amountMinor, percentage: total === 0 ? 0 : (amountMinor / total) * 100 };
  });
}

function getBuckets(range: ReportRange, granularity: ReportGranularity, now: Date) {
  const visibleEnd =
    range.end < addLocalDays(startOfLocalDay(now), 1)
      ? range.end
      : addLocalDays(startOfLocalDay(now), 1);
  const buckets: Pick<TrendPoint, 'start' | 'end' | 'label'>[] = [];
  for (
    let start = getBucketStart(range.start, granularity);
    start < visibleEnd;
    start = nextBucket(start, granularity)
  ) {
    const end = nextBucket(start, granularity);
    buckets.push({ start, end, label: getBucketLabel(start, granularity) });
  }
  return buckets;
}

function getBucketStart(date: Date, granularity: ReportGranularity) {
  if (granularity === 'day') return startOfLocalDay(date);
  if (granularity === 'week') return getCurrentWeekRange(date).start;
  return getMonthRange(date.getFullYear(), date.getMonth()).start;
}

function nextBucket(start: Date, granularity: ReportGranularity) {
  if (granularity === 'day') return addLocalDays(start, 1);
  if (granularity === 'week') return addLocalDays(start, 7);
  return new Date(start.getFullYear(), start.getMonth() + 1, 1);
}

function getBucketLabel(start: Date, granularity: ReportGranularity) {
  if (granularity === 'day')
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(start);
  if (granularity === 'week')
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(start);
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(start);
}

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value))
    throw new ValidationError(`${field} exceeds supported integer minor-unit precision.`);
  return value;
}
