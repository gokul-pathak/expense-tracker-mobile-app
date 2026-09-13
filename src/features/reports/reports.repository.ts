import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';

import type { ReportFilters, ReportRange } from './reports.types';

// Every report aggregate reads live source rows only.
const liveTransaction = isNull(transactions.deletedAt);
const liveCategory = isNull(categories.deletedAt);

export function getSummaryTotals(range: ReportRange, filters?: ReportFilters) {
  return db
    .select({
      incomeMinor: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
      expenseMinor: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(rangeCondition(range), filterCondition(filters)))
    .get();
}

export function getCategoryTotals(
  type: 'income' | 'expense',
  range: ReportRange,
  filters?: ReportFilters,
) {
  const amountMinor = sql<number>`sum(${transactions.amountMinor})`;
  return db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      icon: categories.icon,
      amountMinor,
    })
    .from(transactions)
    .innerJoin(categories, and(liveCategory, eq(transactions.categoryId, categories.id)))
    .where(and(eq(transactions.type, type), rangeCondition(range), filterCondition(filters)))
    .groupBy(categories.id, categories.name, categories.icon)
    .orderBy(desc(amountMinor), categories.id)
    .all();
}

/** Aggregates by financial date; the service maps rows into local calendar buckets. */
export function getDailyIncomeExpenseTotals(range: ReportRange, filters?: ReportFilters) {
  const amountMinor = sql<number>`sum(${transactions.amountMinor})`;
  return db
    .select({ transactionDate: transactions.transactionDate, type: transactions.type, amountMinor })
    .from(transactions)
    .where(
      and(
        or(eq(transactions.type, 'income'), eq(transactions.type, 'expense')),
        rangeCondition(range),
        filterCondition(filters),
      ),
    )
    .groupBy(transactions.transactionDate, transactions.type)
    .all();
}

/** The currencies income and expenses in a range were recorded in, alphabetically. */
export function getIncomeExpenseCurrencies(range: ReportRange) {
  return db
    .selectDistinct({ currency: transactions.currency })
    .from(transactions)
    .where(
      and(
        or(eq(transactions.type, 'income'), eq(transactions.type, 'expense')),
        rangeCondition(range),
      ),
    )
    .orderBy(transactions.currency)
    .all()
    .map((row) => row.currency);
}

/** The largest expenses in a range, one bounded query. Ties go to the later, then newer, row. */
export function getLargestExpenses(range: ReportRange, limit: number, filters?: ReportFilters) {
  return db
    .select({
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      transactionDate: transactions.transactionDate,
      categoryName: categories.name,
      title: transactions.title,
      note: transactions.note,
    })
    .from(transactions)
    .leftJoin(categories, and(liveCategory, eq(transactions.categoryId, categories.id)))
    .where(and(eq(transactions.type, 'expense'), rangeCondition(range), filterCondition(filters)))
    .orderBy(
      desc(transactions.amountMinor),
      desc(transactions.transactionDate),
      desc(transactions.id),
    )
    .limit(limit)
    .all();
}

function rangeCondition(range: ReportRange) {
  return and(
    liveTransaction,
    gte(transactions.transactionDate, range.start),
    lt(transactions.transactionDate, range.end),
  );
}

function filterCondition(filters?: ReportFilters) {
  if (!filters) return undefined;
  const conditions = [];
  if (filters.categoryId !== undefined)
    conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.currency !== undefined) conditions.push(eq(transactions.currency, filters.currency));
  if (filters.accountId !== undefined) {
    conditions.push(
      or(
        and(
          eq(transactions.type, 'income'),
          eq(transactions.destinationAccountId, filters.accountId),
        ),
        and(eq(transactions.type, 'expense'), eq(transactions.sourceAccountId, filters.accountId)),
      ),
    );
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}
