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
