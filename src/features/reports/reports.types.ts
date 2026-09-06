import type { DateRange } from '@/utils/date-range';

export type ReportRange = DateRange;
export type ReportGranularity = 'day' | 'week' | 'month';
export type ReportPreset =
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'last_1_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'custom';

export type ReportFilters = {
  accountId?: number;
  categoryId?: number;
};

export type ReportSummary = {
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
};

export type CategoryBreakdownItem = {
  categoryId: number;
  categoryName: string;
  icon: string | null;
  amountMinor: number;
  percentage: number;
};

export type TrendPoint = {
  start: Date;
  end: Date;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
};

export type MonthlyComparison = {
  currentExpenseMinor: number;
  previousExpenseMinor: number;
  differenceMinor: number;
  percentageChange: number | null;
};

export type ReportInsight =
  | { type: 'biggest_expense_category'; categoryId: number; categoryName: string }
  | { type: 'expense_increase'; percentage: number; differenceMinor: number }
  | { type: 'expense_decrease'; percentage: number; differenceMinor: number }
  | { type: 'savings'; amountMinor: number }
  | { type: 'expense_exceeded_income'; amountMinor: number };
