import { currentPeriodMonth, pickBudgetHighlights } from '@/features/budgets/budget-presentation';
import * as budgetService from '@/features/budgets/budget.service';

import { assertLimit } from './dashboard.service';
import type { HomeBudgetSummary } from './dashboard.types';

/** Home has room for a glance, not for a list. Three rows is the glance. */
const DEFAULT_BUDGET_HIGHLIGHT_LIMIT = 3;

/**
 * This month's plan, for the Home planning section.
 *
 * It composes rather than calculates: the budget engine answers the whole month
 * from one grouped aggregate, and this picks the few rows Home has space for.
 * Home must never sum expenses of its own — a second implementation of "what was
 * spent" is a second answer waiting to disagree with the first.
 *
 * The month is always the current local calendar month, never the latest month
 * that happens to hold a budget. Home is about now.
 *
 * This sits beside `dashboard.service.ts` rather than inside it so that the
 * accounting service keeps its own dependencies. Everything in there is a record
 * of what happened, it is reached by code that has no business loading the
 * budget engine, and a planning module in its import graph would follow it
 * everywhere.
 */
export function getHomeBudgetSummary(options?: {
  now?: Date;
  highlightLimit?: number;
}): HomeBudgetSummary {
  const highlightLimit = options?.highlightLimit ?? DEFAULT_BUDGET_HIGHLIGHT_LIMIT;
  assertLimit(highlightLimit, 'Budget highlight limit');

  const month = currentPeriodMonth(options?.now);
  const summary = budgetService.getMonthlyBudgetSummary(month);

  return {
    month: summary.month,
    currency: summary.currency,
    overall: summary.overallBudget,
    highlights: pickBudgetHighlights(summary.categoryBudgets, highlightLimit),
    categoryBudgetCount: summary.categoryBudgets.length,
    categoryBudgetedMinor: summary.categoryBudgetedMinor,
    hasAnyBudget: summary.overallBudget !== null || summary.categoryBudgets.length > 0,
  };
}
