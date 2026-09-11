import type { PeriodMonth } from '@/features/budgets/budget.period';
import type { BudgetProgress } from '@/features/budgets/budget.types';
import type { TransactionView } from '@/features/transactions/transaction.types';

export type CategorySpending = {
  categoryId: number;
  categoryName: string;
  categoryIcon: string | null;
  amountMinor: number;
  percentage: number;
};

export type DashboardSummary = {
  totalBalanceMinor: number;
  monthlyIncomeMinor: number;
  monthlyExpenseMinor: number;
  monthlySavingsMinor: number;
  categorySpending: CategorySpending[];
  recentTransactions: TransactionView[];
};

/**
 * The planning section of Home, kept out of `DashboardSummary` on purpose.
 *
 * Everything in `DashboardSummary` is a record of what happened. A budget is a
 * record of what was intended, and mixing the two in one object is how a
 * planning figure eventually ends up inside a balance. Home reads both and
 * shows them as two separate things, which is what they are.
 */
export type HomeBudgetSummary = {
  month: PeriodMonth;
  currency: string;
  /** The month's overall plan, when one exists. Only this is "the monthly budget". */
  overall: BudgetProgress | null;
  /** The few category budgets worth a glance: over budget first, then nearest to it. */
  highlights: BudgetProgress[];
  /** How many category budgets the month has, so Home can say what it is not showing. */
  categoryBudgetCount: number;
  /**
   * The sum of the category budgets. Never presented as an overall budget — an
   * overall plan is one the user actually set, and a sum of parts is not it.
   */
  categoryBudgetedMinor: number;
  hasAnyBudget: boolean;
};
