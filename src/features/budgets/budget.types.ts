import type { Budget, NewBudget } from '@/db/schema/budgets';

import type { PeriodMonth } from './budget.period';

export type { Budget };

export type CreateBudgetInput = {
  /** Null or omitted is the overall monthly budget. */
  categoryId?: number | null;
  /** `YYYY-MM`, or a `Date` / `YYYY-MM-01` that normalizes to one. */
  periodMonth: PeriodMonth | Date;
  amountMinor: number;
  /** Defaults to the app's configured default currency. */
  currency?: string;
};

/**
 * Amount, month, category and currency may all be edited. Editing a budget
 * changes the plan and nothing else: no spending record is touched, and what
 * was spent is recomputed against the new plan rather than adjusted.
 */
export type UpdateBudgetInput = Partial<CreateBudgetInput>;

export type CreateBudgetRecord = Pick<
  NewBudget,
  'categoryId' | 'periodMonth' | 'amountMinor' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type UpdateBudgetRecord = Pick<NewBudget, 'updatedAt'> &
  Partial<Pick<NewBudget, 'categoryId' | 'periodMonth' | 'amountMinor' | 'currency'>>;

/**
 * How a budget stands against what was actually spent.
 *
 * Deliberately factual and deliberately uncapped. `over_budget` is a
 * measurement; it is not advice, and nothing here suggests what anyone should do
 * about it.
 */
export const BUDGET_STATUSES = ['unused', 'within_budget', 'at_budget', 'over_budget'] as const;

export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export type BudgetProgress = {
  budget: Budget;
  /** The category's current name, so a rename shows through without moving the budget. */
  categoryName: string | null;
  /** Sum of matching expenses. Integer minor units, like every amount here. */
  spentMinor: number;
  /** `amount - spent`. Negative when overspent, which is the point of keeping it signed. */
  remainingMinor: number;
  /** `max(0, spent - amount)`. Zero unless overspent. */
  overspentMinor: number;
  /**
   * `spent / amount * 100`, unrounded and uncapped: 60 means 60%, 125 means 125%.
   * A ratio is display-only, so it is the one number here that is not an
   * integer. Money never is.
   */
  percentage: number;
  status: BudgetStatus;
};

/**
 * One month's plan, for one currency.
 *
 * Budgets are per-currency and never converted, so a summary is always about a
 * single currency. A month holding budgets in two currencies has two summaries.
 */
export type MonthlyBudgetSummary = {
  month: PeriodMonth;
  currency: string;
  /** The overall plan for the month, when one exists. */
  overallBudget: BudgetProgress | null;
  categoryBudgets: BudgetProgress[];
  /** Sum of the category budget amounts. Not the overall budget. */
  categoryBudgetedMinor: number;
  /**
   * The month's planning limit: the overall budget's amount when one exists,
   * otherwise the sum of the category budgets. The two are never added — an
   * overall budget already covers the spending its category budgets cover, so
   * summing them would count the same plan twice. Null when the month has no
   * budget at all, which is not the same as a plan of zero.
   */
  totalBudgetedMinor: number | null;
  /** Every expense in the month, in this currency, whether budgeted or not. */
  totalSpentMinor: number;
};
