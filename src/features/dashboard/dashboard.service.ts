import { getAppSettings } from '@/features/settings/settings.service';
import { ValidationError } from '@/features/shared/errors';
import { getCurrentMonthRange, type DateRange } from '@/utils/date-range';

import * as repository from './dashboard.repository';
import type { CategorySpending, DashboardSummary } from './dashboard.types';

const DEFAULT_CATEGORY_LIMIT = 5;
const DEFAULT_RECENT_TRANSACTION_LIMIT = 5;

/**
 * Home's figures.
 *
 * **One currency.** Total Balance and this month's income, expense, savings and
 * spending are in a single currency — the default currency, unless another is
 * asked for — because the app never converts. Cash held in accounts of any other
 * currency is listed in `otherCurrencies`, one balance per currency, and added to
 * nothing: printing rupees and dollars summed as rupees is a wrong balance, not a
 * rounding difference.
 */
export function getDashboardSummary(options?: {
  now?: Date;
  /** Defaults to the app's default currency. */
  currency?: string;
  categoryLimit?: number;
  recentTransactionLimit?: number;
}): DashboardSummary {
  const categoryLimit = options?.categoryLimit ?? DEFAULT_CATEGORY_LIMIT;
  const recentTransactionLimit =
    options?.recentTransactionLimit ?? DEFAULT_RECENT_TRANSACTION_LIMIT;
  assertLimit(categoryLimit, 'Category limit');
  assertLimit(recentTransactionLimit, 'Recent transaction limit');

  const currency = options?.currency ?? getAppSettings().defaultCurrency;
  const range = getCurrentMonthRange(options?.now);
  const accountCurrencies = repository.listActiveAccountCurrencies();
  const totalBalanceMinor = getTotalBalance(currency);
  const monthlyIncomeMinor = getIncomeForRange(range, currency);
  const monthlyExpenseMinor = getExpenseForRange(range, currency);
  const monthlySavingsMinor = subtract(monthlyIncomeMinor, monthlyExpenseMinor, 'Monthly savings');
  const categorySpending = getExpenseByCategory(
    range,
    currency,
    categoryLimit,
    monthlyExpenseMinor,
  );

  return {
    currency,
    accountCount: accountCurrencies.find((entry) => entry.currency === currency)?.accountCount ?? 0,
    totalBalanceMinor,
    monthlyIncomeMinor,
    monthlyExpenseMinor,
    monthlySavingsMinor,
    categorySpending,
    recentTransactions: repository.getRecentTransactions(recentTransactionLimit),
    otherCurrencies: accountCurrencies
      .filter((entry) => entry.currency !== currency)
      .map((entry) => ({
        currency: entry.currency,
        accountCount: entry.accountCount,
        totalBalanceMinor: getTotalBalance(entry.currency),
      })),
  };
}

/** Cash in the active accounts of one currency. */
export function getTotalBalance(currency: string) {
  const openingBalanceMinor = assertSafeInteger(
    repository.getActiveAccountOpeningBalanceTotal(currency),
    'Active account opening balance total',
  );
  const incomeMinor = assertSafeInteger(
    repository.getActiveAccountIncomeTotal(currency),
    'Active account income total',
  );
  const expenseMinor = assertSafeInteger(
    repository.getActiveAccountExpenseTotal(currency),
    'Active account expense total',
  );
  const transferReceivedMinor = assertSafeInteger(
    repository.getActiveAccountTransferReceivedTotal(currency),
    'Active account transfer received total',
  );
  const transferSentMinor = assertSafeInteger(
    repository.getActiveAccountTransferSentTotal(currency),
    'Active account transfer sent total',
  );
  const lentMinor = assertSafeInteger(
    repository.getActiveAccountLendTotal(currency),
    'Active account lend total',
  );
  const borrowedMinor = assertSafeInteger(
    repository.getActiveAccountBorrowTotal(currency),
    'Active account borrow total',
  );
  const repaymentsReceivedMinor = assertSafeInteger(
    repository.getActiveAccountRepaymentReceivedTotal(currency),
    'Active account repayments received total',
  );
  const repaymentsPaidMinor = assertSafeInteger(
    repository.getActiveAccountRepaymentPaidTotal(currency),
    'Active account repayments paid total',
  );
  // Total Balance is cash in accounts. Money moved into an investment leaves it,
  // money from a sale comes back into it, and what the investments are worth is
  // a separate figure that is never added here.
  const investedMinor = assertSafeInteger(
    repository.getActiveAccountInvestmentTotal(currency),
    'Active account investment total',
  );
  const investmentReturnsMinor = assertSafeInteger(
    repository.getActiveAccountInvestmentReturnTotal(currency),
    'Active account investment returns total',
  );
  return subtract(
    add(
      add(
        add(openingBalanceMinor, incomeMinor, 'Total balance'),
        transferReceivedMinor,
        'Total balance',
      ),
      add(
        add(borrowedMinor, repaymentsReceivedMinor, 'Total balance'),
        investmentReturnsMinor,
        'Total balance',
      ),
      'Total balance',
    ),
    add(
      add(expenseMinor, transferSentMinor, 'Total balance'),
      add(add(lentMinor, repaymentsPaidMinor, 'Total balance'), investedMinor, 'Total balance'),
      'Total balance',
    ),
    'Total balance',
  );
}

export function getIncomeForRange(range: DateRange, currency: string) {
  return assertSafeInteger(repository.getIncomeForRange(range, currency), 'Income total');
}

export function getExpenseForRange(range: DateRange, currency: string) {
  return assertSafeInteger(repository.getExpenseForRange(range, currency), 'Expense total');
}

export function getExpenseByCategory(
  range: DateRange,
  currency: string,
  limit = DEFAULT_CATEGORY_LIMIT,
  totalExpenseMinor = getExpenseForRange(range, currency),
): CategorySpending[] {
  assertLimit(limit, 'Category limit');
  const total = assertSafeInteger(totalExpenseMinor, 'Expense total');

  return repository.getExpenseByCategory(range, limit, currency).map((category) => {
    const amountMinor = assertSafeInteger(category.amountMinor, 'Category expense total');
    return {
      ...category,
      amountMinor,
      percentage: total === 0 ? 0 : Math.round((amountMinor / total) * 100),
    };
  });
}

export function assertLimit(value: number, field: string) {
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
