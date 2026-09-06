import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountRepository = vi.hoisted(() => ({ getAccountById: vi.fn(), getAccounts: vi.fn() }));
const transactionRepository = vi.hoisted(() => ({
  getAccountBorrowTotal: vi.fn(),
  getAccountExpenseTotal: vi.fn(),
  getAccountIncomeTotal: vi.fn(),
  getAccountLendTotal: vi.fn(),
  getAccountRepaymentPaidTotal: vi.fn(),
  getAccountRepaymentReceivedTotal: vi.fn(),
  getAccountTransferReceivedTotal: vi.fn(),
  getAccountTransferSentTotal: vi.fn(),
  getBorrowTotal: vi.fn(),
  getExpenseTotal: vi.fn(),
  getIncomeTotal: vi.fn(),
  getLendTotal: vi.fn(),
  getRepaymentPaidTotal: vi.fn(),
  getRepaymentReceivedTotal: vi.fn(),
}));
const dashboardRepository = vi.hoisted(() => ({
  getActiveAccountBorrowTotal: vi.fn(),
  getActiveAccountExpenseTotal: vi.fn(),
  getActiveAccountIncomeTotal: vi.fn(),
  getActiveAccountLendTotal: vi.fn(),
  getActiveAccountOpeningBalanceTotal: vi.fn(),
  getActiveAccountRepaymentPaidTotal: vi.fn(),
  getActiveAccountRepaymentReceivedTotal: vi.fn(),
  getActiveAccountTransferReceivedTotal: vi.fn(),
  getActiveAccountTransferSentTotal: vi.fn(),
  getExpenseByCategory: vi.fn(),
  getExpenseForRange: vi.fn(),
  getIncomeForRange: vi.fn(),
  getRecentTransactions: vi.fn(),
}));
const reportsRepository = vi.hoisted(() => ({
  getCategoryTotals: vi.fn(),
  getDailyIncomeExpenseTotals: vi.fn(),
  getSummaryTotals: vi.fn(),
}));

vi.mock('@/features/accounts/account.repository', () => accountRepository);
vi.mock('@/features/transactions/transaction.repository', () => transactionRepository);
vi.mock('@/features/dashboard/dashboard.repository', () => dashboardRepository);
vi.mock('@/features/reports/reports.repository', () => reportsRepository);

import { getAccountBalance, getTotalBalance } from '@/features/transactions/account-balance.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import {
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getReportSummary,
} from '@/features/reports/reports.service';
import { getMonthRange } from '@/utils/date-range';

describe('derived financial aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(transactionRepository)) fn.mockReturnValue(0);
    for (const fn of Object.values(dashboardRepository)) fn.mockReturnValue(0);
    accountRepository.getAccountById.mockReturnValue({ id: 1, openingBalanceMinor: 10000 });
    accountRepository.getAccounts.mockReturnValue([{ id: 1, openingBalanceMinor: 10000 }]);
    dashboardRepository.getRecentTransactions.mockReturnValue([]);
    dashboardRepository.getExpenseByCategory.mockReturnValue([]);
    reportsRepository.getSummaryTotals.mockReturnValue({ incomeMinor: 0, expenseMinor: 0 });
    reportsRepository.getCategoryTotals.mockReturnValue([]);
    reportsRepository.getDailyIncomeExpenseTotals.mockReturnValue([]);
  });

  it('derives opening balance, income, expense, transfer, and debt movements exactly', () => {
    transactionRepository.getAccountIncomeTotal.mockReturnValue(5000);
    transactionRepository.getAccountExpenseTotal.mockReturnValue(3000);
    transactionRepository.getAccountTransferReceivedTotal.mockReturnValue(2000);
    transactionRepository.getAccountTransferSentTotal.mockReturnValue(1000);
    transactionRepository.getAccountLendTotal.mockReturnValue(4000);
    transactionRepository.getAccountBorrowTotal.mockReturnValue(3000);
    transactionRepository.getAccountRepaymentReceivedTotal.mockReturnValue(500);
    transactionRepository.getAccountRepaymentPaidTotal.mockReturnValue(250);
    expect(getAccountBalance(1)).toBe(12250);
  });

  it('keeps same-currency transfer totals neutral across all accounts', () => {
    transactionRepository.getIncomeTotal.mockReturnValue(5000);
    transactionRepository.getExpenseTotal.mockReturnValue(3000);
    expect(getTotalBalance()).toBe(12000);
  });

  it('excludes opening balance from dashboard income and savings', () => {
    dashboardRepository.getActiveAccountOpeningBalanceTotal.mockReturnValue(10000);
    dashboardRepository.getActiveAccountIncomeTotal.mockReturnValue(5000);
    dashboardRepository.getActiveAccountExpenseTotal.mockReturnValue(3000);
    dashboardRepository.getIncomeForRange.mockReturnValue(5000);
    dashboardRepository.getExpenseForRange.mockReturnValue(3000);
    dashboardRepository.getExpenseByCategory.mockReturnValue([
      { categoryId: 1, categoryName: 'Food', categoryIcon: 'food', amountMinor: 3000 },
    ]);

    expect(getDashboardSummary({ now: new Date(2024, 8, 15) })).toMatchObject({
      totalBalanceMinor: 12000,
      monthlyIncomeMinor: 5000,
      monthlyExpenseMinor: 3000,
      monthlySavingsMinor: 2000,
      categorySpending: [{ amountMinor: 3000, percentage: 100 }],
    });
  });

  it('returns report income, expense, savings, category breakdown, and trend from dated rows only', () => {
    const range = getMonthRange(2024, 8);
    reportsRepository.getSummaryTotals.mockReturnValue({ incomeMinor: 5000, expenseMinor: 3000 });
    reportsRepository.getCategoryTotals.mockReturnValue([
      { categoryId: 1, categoryName: 'Food', categoryIcon: 'food', amountMinor: 3000 },
    ]);
    reportsRepository.getDailyIncomeExpenseTotals.mockReturnValue([
      { type: 'expense', amountMinor: 3000, transactionDate: new Date(2024, 8, 1) },
      { type: 'income', amountMinor: 5000, transactionDate: new Date(2024, 8, 1) },
    ]);

    expect(getReportSummary(range)).toEqual({ incomeMinor: 5000, expenseMinor: 3000, savingsMinor: 2000 });
    expect(getExpenseCategoryBreakdown(range)).toEqual([
      { categoryId: 1, categoryName: 'Food', categoryIcon: 'food', amountMinor: 3000, percentage: 100 },
    ]);
    expect(getIncomeExpenseTrend(range, 'day', { now: new Date(2024, 8, 30) })[0]).toMatchObject({
      incomeMinor: 5000,
      expenseMinor: 3000,
    });
  });
});
