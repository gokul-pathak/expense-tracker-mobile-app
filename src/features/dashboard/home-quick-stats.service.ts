import { getIncomeExpenseTrend } from '@/features/reports/reports.service';
import { getAppSettings } from '@/features/settings/settings.service';
import { ValidationError } from '@/features/shared/errors';
import { getPeopleFinancialSummaryByCurrency } from '@/features/transactions/transaction.service';
import { addLocalDays, startOfLocalDay } from '@/utils/date-range';

import type { HomeCashflow, HomePeopleTotals } from './dashboard.types';

const CASHFLOW_DAYS = 7;

/**
 * What people owe the user and what the user owes them, in one currency.
 *
 * Not computed here: these are the People screen's own totals, so Home and People
 * cannot disagree about the same debt. A currency other than Home's is only named,
 * because the app never converts.
 */
export function getHomePeopleTotals(options?: { currency?: string }): HomePeopleTotals {
  const currency = options?.currency ?? getAppSettings().defaultCurrency;
  const groups = getPeopleFinancialSummaryByCurrency();
  const own = groups.find((group) => group.currency === currency);
  return {
    currency,
    receivableMinor: assertSafeInteger(own?.totalReceivableMinor ?? 0, 'Receivable total'),
    liabilityMinor: assertSafeInteger(own?.totalLiabilityMinor ?? 0, 'Liability total'),
    otherCurrencies: groups
      .filter(
        (group) =>
          group.currency !== currency &&
          (group.totalReceivableMinor !== 0 || group.totalLiabilityMinor !== 0),
      )
      .map((group) => group.currency),
  };
}

/**
 * Income and expense for each of the last seven days, oldest first and ending
 * today, in one currency.
 *
 * This is the Reports trend over seven days, so a week on Home and the same week
 * on Reports are the same figures. Transfers, lending, repayments and money moved
 * into or out of an investment are neither income nor expense, there as here.
 */
export function getHomeCashflow(options?: { now?: Date; currency?: string }): HomeCashflow {
  const now = options?.now ?? new Date();
  const currency = options?.currency ?? getAppSettings().defaultCurrency;
  const end = addLocalDays(startOfLocalDay(now), 1);
  const range = { start: addLocalDays(end, -CASHFLOW_DAYS), end };

  const days = getIncomeExpenseTrend(range, 'day', { filters: { currency }, now }).map(
    ({ start, label, incomeMinor, expenseMinor }) => ({ start, label, incomeMinor, expenseMinor }),
  );
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const day of days) {
    incomeMinor = assertSafeInteger(incomeMinor + day.incomeMinor, 'Cashflow income');
    expenseMinor = assertSafeInteger(expenseMinor + day.expenseMinor, 'Cashflow expense');
  }
  return { currency, days, incomeMinor, expenseMinor };
}

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} exceeds supported integer minor-unit precision.`);
  }
  return value;
}
