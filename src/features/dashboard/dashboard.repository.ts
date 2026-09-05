import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';
import { getRecentTransactionViews } from '@/features/transactions/transaction.repository';

import type { DateRange } from '@/utils/date-range';

const totalAmount = sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`;

export function getActiveAccountOpeningBalanceTotal() {
  return getAccountTotal(accounts.openingBalanceMinor);
}

export function getActiveAccountIncomeTotal() {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(transactions.destinationAccountId, accounts.id), eq(accounts.isArchived, false)),
    )
    .where(eq(transactions.type, 'income'))
    .get();

  return result?.total ?? 0;
}

export function getActiveAccountExpenseTotal() {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(transactions.sourceAccountId, accounts.id), eq(accounts.isArchived, false)),
    )
    .where(eq(transactions.type, 'expense'))
    .get();

  return result?.total ?? 0;
}

export function getActiveAccountTransferReceivedTotal() {
  return getActiveAccountTransactionTotal('transfer', transactions.destinationAccountId);
}

export function getActiveAccountTransferSentTotal() {
  return getActiveAccountTransactionTotal('transfer', transactions.sourceAccountId);
}

export function getIncomeForRange(range: DateRange) {
  return getTransactionTotalForRange('income', range);
}

export function getExpenseForRange(range: DateRange) {
  return getTransactionTotalForRange('expense', range);
}

export function getExpenseByCategory(range: DateRange, limit: number) {
  const categoryAmount = sql<number>`sum(${transactions.amountMinor})`;
  return db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      amountMinor: categoryAmount,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.type, 'expense'),
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

function getAccountTotal(column: typeof accounts.openingBalanceMinor) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${column}), 0)` })
    .from(accounts)
    .where(eq(accounts.isArchived, false))
    .get();

  return result?.total ?? 0;
}

function getActiveAccountTransactionTotal(
  type: 'income' | 'expense' | 'transfer',
  accountColumn: typeof transactions.sourceAccountId,
) {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .innerJoin(accounts, and(eq(accountColumn, accounts.id), eq(accounts.isArchived, false)))
    .where(eq(transactions.type, type))
    .get();

  return result?.total ?? 0;
}

function getTransactionTotalForRange(type: 'income' | 'expense', range: DateRange) {
  const result = db
    .select({ total: totalAmount })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, type),
        gte(transactions.transactionDate, range.start),
        lt(transactions.transactionDate, range.end),
      ),
    )
    .get();

  return result?.total ?? 0;
}
