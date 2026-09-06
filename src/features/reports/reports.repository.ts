import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';

import type { ReportFilters, ReportRange } from './reports.types';

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
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
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

function rangeCondition(range: ReportRange) {
  return and(
    gte(transactions.transactionDate, range.start),
    lt(transactions.transactionDate, range.end),
  );
}

function filterCondition(filters?: ReportFilters) {
  if (!filters) return undefined;
  const conditions = [];
  if (filters.categoryId !== undefined)
    conditions.push(eq(transactions.categoryId, filters.categoryId));
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
