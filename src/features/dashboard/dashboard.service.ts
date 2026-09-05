import { ValidationError } from '@/features/shared/errors';
import { getCurrentMonthRange, type DateRange } from '@/utils/date-range';

import * as repository from './dashboard.repository';
import type { CategorySpending, DashboardSummary } from './dashboard.types';

const DEFAULT_CATEGORY_LIMIT = 5;
const DEFAULT_RECENT_TRANSACTION_LIMIT = 5;

export function getDashboardSummary(options?: {
  now?: Date;
  categoryLimit?: number;
  recentTransactionLimit?: number;
}): DashboardSummary {
  const categoryLimit = options?.categoryLimit ?? DEFAULT_CATEGORY_LIMIT;
  const recentTransactionLimit =
    options?.recentTransactionLimit ?? DEFAULT_RECENT_TRANSACTION_LIMIT;
  assertLimit(categoryLimit, 'Category limit');
  assertLimit(recentTransactionLimit, 'Recent transaction limit');

  const range = getCurrentMonthRange(options?.now);
  const totalBalanceMinor = getTotalBalance();
  const monthlyIncomeMinor = getIncomeForRange(range);
  const monthlyExpenseMinor = getExpenseForRange(range);
  const monthlySavingsMinor = subtract(monthlyIncomeMinor, monthlyExpenseMinor, 'Monthly savings');
  const categorySpending = getExpenseByCategory(range, categoryLimit, monthlyExpenseMinor);

  return {
    totalBalanceMinor,
    monthlyIncomeMinor,
    monthlyExpenseMinor,
    monthlySavingsMinor,
    categorySpending,
    recentTransactions: repository.getRecentTransactions(recentTransactionLimit),
  };
}

export function getTotalBalance() {
  const openingBalanceMinor = assertSafeInteger(
    repository.getActiveAccountOpeningBalanceTotal(),
    'Active account opening balance total',
  );
  const incomeMinor = assertSafeInteger(
    repository.getActiveAccountIncomeTotal(),
    'Active account income total',
  );
  const expenseMinor = assertSafeInteger(
    repository.getActiveAccountExpenseTotal(),
    'Active account expense total',
  );
  return subtract(
    add(openingBalanceMinor, incomeMinor, 'Total balance'),
    expenseMinor,
    'Total balance',
  );
}

export function getIncomeForRange(range: DateRange) {
  return assertSafeInteger(repository.getIncomeForRange(range), 'Income total');
}

export function getExpenseForRange(range: DateRange) {
  return assertSafeInteger(repository.getExpenseForRange(range), 'Expense total');
}

export function getExpenseByCategory(
  range: DateRange,
  limit = DEFAULT_CATEGORY_LIMIT,
  totalExpenseMinor = getExpenseForRange(range),
): CategorySpending[] {
  assertLimit(limit, 'Category limit');
  const total = assertSafeInteger(totalExpenseMinor, 'Expense total');

  return repository.getExpenseByCategory(range, limit).map((category) => {
    const amountMinor = assertSafeInteger(category.amountMinor, 'Category expense total');
    return {
      ...category,
      amountMinor,
      percentage: total === 0 ? 0 : Math.round((amountMinor / total) * 100),
    };
  });
}

function assertLimit(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
}

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} exceeds supported integer minor-unit precision.`);
  }
  return value;
}

function add(left: number, right: number, field: string) {
  return assertSafeInteger(left + right, field);
}

function subtract(left: number, right: number, field: string) {
  return assertSafeInteger(left - right, field);
}
