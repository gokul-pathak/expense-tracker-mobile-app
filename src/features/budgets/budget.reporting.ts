import * as settingsRepository from '@/features/settings/settings.repository';
import { NotFoundError } from '@/features/shared/errors';

import {
  formatPeriodMonth,
  monthRange,
  normalizePeriodMonth,
  type PeriodMonth,
} from './budget.period';
import { budgetStatusOf } from './budget.progress';
import * as repository from './budget.repository';
import type { BudgetStatus } from './budget.types';
import { normalizeCurrency } from './budget.validation';

/**
 * Budget against actual, for a span of months.
 *
 * Reports ask a different question from the budgets screen: not "how does this
 * month stand" but "how did each of these months stand". Answering it a month at
 * a time would be a query per month per budget; this reads every budget in the
 * span in one query and every expense in the span in another, then does the
 * calendar arithmetic in one pass.
 *
 * The months come in already decided — see `periodMonthsInRange`. Nothing here
 * prorates, and nothing here invents a month that was not asked for.
 */

export type MonthlyBudgetComparison = {
  month: PeriodMonth;
  currency: string;
  /**
   * The month's planning limit, or null when the month has no budget at all.
   * Null is not zero: "no budget set" and "a budget of nothing" are different
   * answers, and only one of them is ever true here.
   */
  budgetedMinor: number | null;
  /**
   * Which plan `budgetedMinor` came from. An overall budget already covers the
   * spending its category budgets cover, so the two are never added — the
   * overall figure wins outright when one exists.
   */
  source: 'overall' | 'categories' | 'none';
  /** Every expense in the month, in this currency, budgeted or not. */
  spentMinor: number;
  /** Signed, and null when there is no plan to measure against. */
  remainingMinor: number | null;
  percentage: number | null;
  status: BudgetStatus | null;
};

export function getBudgetComparisonForMonths(
  months: PeriodMonth[],
  currency?: string,
): MonthlyBudgetComparison[] {
  const resolvedCurrency = normalizeCurrency(currency ?? defaultCurrency());
  const normalized = months.map(normalizePeriodMonth);
  if (normalized.length === 0) return [];

  const spentByMonth = sumExpensesByMonth(normalized, resolvedCurrency);
  const plans = planByMonth(normalized, resolvedCurrency);

  return normalized.map((month) => {
    const spentMinor = spentByMonth.get(month) ?? 0;
    const plan = plans.get(month);
    if (plan === undefined) {
      return {
        month,
        currency: resolvedCurrency,
        budgetedMinor: null,
        source: 'none',
        spentMinor,
        remainingMinor: null,
        percentage: null,
        status: null,
      };
    }
    return {
      month,
      currency: resolvedCurrency,
      budgetedMinor: plan.amountMinor,
      source: plan.source,
      spentMinor,
      remainingMinor: plan.amountMinor - spentMinor,
      percentage: (spentMinor / plan.amountMinor) * 100,
      status: budgetStatusOf(spentMinor, plan.amountMinor),
    };
  });
}

/**
 * One query over the whole span, bucketed into local calendar months here.
 *
 * The span runs from the first month's start to the last month's end, so months
 * the caller did not ask for are never read — and a caller asking for a gap in
 * the middle simply gets nothing for the months it skipped, because the bucket
 * map is keyed by the months it did ask for.
 */
function sumExpensesByMonth(months: PeriodMonth[], currency: string): Map<PeriodMonth, number> {
  const sorted = [...months].sort();
  const start = monthRange(sorted[0]!).start;
  const end = monthRange(sorted[sorted.length - 1]!).end;

  const totals = new Map<PeriodMonth, number>();
  for (const row of repository.getExpenseTotalsByDateAndCategory({ start, end }, currency)) {
    const month = formatPeriodMonth(row.transactionDate);
    totals.set(month, (totals.get(month) ?? 0) + row.amountMinor);
  }
  return totals;
}

/**
 * Each month's limit, from one query across every month in the span.
 *
 * The overall budget is the month's limit when there is one. Otherwise the
 * category budgets are summed, because with no overall plan they are the whole
 * of the plan — but they are never added to an overall budget that exists.
 */
function planByMonth(
  months: PeriodMonth[],
  currency: string,
): Map<PeriodMonth, { amountMinor: number; source: 'overall' | 'categories' }> {
  const overall = new Map<PeriodMonth, number>();
  const categoryTotals = new Map<PeriodMonth, number>();

  for (const row of repository.getBudgetsForMonthsAndCurrency(months, currency)) {
    const month = row.budget.periodMonth;
    if (row.budget.categoryId === null) overall.set(month, row.budget.amountMinor);
    else categoryTotals.set(month, (categoryTotals.get(month) ?? 0) + row.budget.amountMinor);
  }

  const plans = new Map<PeriodMonth, { amountMinor: number; source: 'overall' | 'categories' }>();
  for (const month of months) {
    const overallAmount = overall.get(month);
    if (overallAmount !== undefined) {
      plans.set(month, { amountMinor: overallAmount, source: 'overall' });
      continue;
    }
    const categoryAmount = categoryTotals.get(month);
    if (categoryAmount !== undefined) {
      plans.set(month, { amountMinor: categoryAmount, source: 'categories' });
    }
  }
  return plans;
}

function defaultCurrency(): string {
  const settings = settingsRepository.getSettings();
  if (settings === null || settings === undefined) {
    throw new NotFoundError('Application settings were not found.');
  }
  return settings.defaultCurrency;
}
