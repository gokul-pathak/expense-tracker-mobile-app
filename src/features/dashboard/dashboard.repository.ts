import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';
import { getRecentTransactionViews } from '@/features/transactions/transaction.repository';

import type { DateRange } from '@/utils/date-range';

/**
 * Home's figures, one currency at a time.
 *
 * Every total here takes the currency it is for. The app never converts, so a
 * sum across accounts in different currencies would add rupees to dollars and
 * print the result as rupees. A transaction always carries its account's
 * currency, so filtering accounts and filtering transactions agree.
 */

const totalAmount = sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`;
// Tombstoned source rows never contribute to a derived financial figure.
const liveTransaction = isNull(transactions.deletedAt);
const liveAccount = isNull(accounts.deletedAt);
const liveCategory = isNull(categories.deletedAt);

/** Each currency held by an active account, with how many active accounts hold it. */
export function listActiveAccountCurrencies(): { currency: string; accountCount: number }[] {
  return db
    .select({ currency: accounts.currency, accountCount: count() })
    .from(accounts)
    .where(and(liveAccount, eq(accounts.isArchived, false)))
    .groupBy(accounts.currency)
    .orderBy(asc(accounts.currency))
    .all();
}

export function getActiveAccountOpeningBalanceTotal(currency: string) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${accounts.openingBalanceMinor}), 0)` })
    .from(accounts)
    .where(and(liveAccount, eq(accounts.isArchived, false), eq(accounts.currency, currency)))
    .get();

  return result?.total ?? 0;
}

export function getActiveAccountIncomeTotal(currency: string) {
  return getActiveAccountTransactionTotal('income', transactions.destinationAccountId, currency);
}

export function getActiveAccountExpenseTotal(currency: string) {
  return getActiveAccountTransactionTotal('expense', transactions.sourceAccountId, currency);
}

export function getActiveAccountTransferReceivedTotal(currency: string) {
  return getActiveAccountTransactionTotal('transfer', transactions.destinationAccountId, currency);
}

export function getActiveAccountTransferSentTotal(currency: string) {
  return getActiveAccountTransactionTotal('transfer', transactions.sourceAccountId, currency);
}

export function getActiveAccountLendTotal(currency: string) {
  return getActiveAccountTransactionTotal('lend', transactions.sourceAccountId, currency);
}

export function getActiveAccountBorrowTotal(currency: string) {
  return getActiveAccountTransactionTotal('borrow', transactions.destinationAccountId, currency);
}

export function getActiveAccountRepaymentReceivedTotal(currency: string) {
  return getActiveAccountTransactionTotal(
    'repayment_received',
    transactions.destinationAccountId,
    currency,
  );
}

export function getActiveAccountRepaymentPaidTotal(currency: string) {
  return getActiveAccountTransactionTotal('repayment_paid', transactions.sourceAccountId, currency);
}

/** Cash paid into investments from active accounts. Never what the investments are worth. */
export function getActiveAccountInvestmentTotal(currency: string) {
  return getActiveAccountTransactionTotal('investment', transactions.sourceAccountId, currency);
}

/** Cash returned to active accounts from selling investments. */
export function getActiveAccountInvestmentReturnTotal(currency: string) {
  return getActiveAccountTransactionTotal(
    'investment_return',
    transactions.destinationAccountId,
    currency,
  );
}

export function getIncomeForRange(range: DateRange, currency: string) {
  return getTransactionTotalForRange('income', range, currency);
}

export function getExpenseForRange(range: DateRange, currency: string) {
  return getTransactionTotalForRange('expense', range, currency);
}

export function getExpenseByCategory(range: DateRange, limit: number, currency: string) {
  const categoryAmount = sql<number>`sum(${transactions.amountMinor})`;
  return db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      amountMinor: categoryAmount,
    })
    .from(transactions)
    .innerJoin(categories, and(liveCategory, eq(transactions.categoryId, categories.id)))
    .where(
      and(
        liveTransaction,
        eq(transactions.type, 'expense'),
        eq(transactions.currency, currency),
        eq(categories.type, 'expense'),
        gte(transactions.transactionDate, range.start),
        lt(transactions.transactionDate, range.end),
      ),
    )
    .groupBy(categories.id, categories.name, categories.icon)
    .orderBy(desc(categoryAmount), asc(categories.id))
    .limit(limit)
    .all();
}

export function getRecentTransactions(limit: number) {
  return getRecentTransactionViews(limit);
}

function getActiveAccountTransactionTotal(
  type: TransactionType,
  accountColumn: typeof transactions.sourceAccountId,
  currency: string,
) {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        liveAccount,
        eq(accountColumn, accounts.id),
        eq(accounts.isArchived, false),
        eq(accounts.currency, currency),
      ),
    )
    .where(and(liveTransaction, eq(transactions.type, type)))
    .get();

  return result?.total ?? 0;
}

function getTransactionTotalForRange(
  type: 'income' | 'expense',
  range: DateRange,
  currency: string,
) {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .where(
      and(
        liveTransaction,
        eq(transactions.type, type),
        eq(transactions.currency, currency),
        gte(transactions.transactionDate, range.start),
        lt(transactions.transactionDate, range.end),
      ),
    )
    .get();

  return result?.total ?? 0;
}
