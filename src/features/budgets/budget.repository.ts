import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import { budgets } from '@/db/schema/budgets';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import type { MonthRange, PeriodMonth } from './budget.period';
import type { CreateBudgetRecord, UpdateBudgetRecord } from './budget.types';

/**
 * Budget reads and writes.
 *
 * Nothing here stores what was spent. Spending is a `sum` over the month's
 * expense transactions, computed by SQLite each time it is asked for, so a
 * budget cannot fall out of step with the records behind it — there is no
 * counter to forget to update when a transaction is edited, moved or deleted.
 */

const live = isNull(budgets.deletedAt);

const budgetOrder = [asc(budgets.periodMonth), asc(budgets.categoryId), asc(budgets.id)] as const;

/**
 * Budget rows carry the category's current name and icon, so a rename or a
 * change of icon shows through without the budget moving, and so no screen has
 * to fetch the category list a second time just to draw a row.
 */
const budgetView = {
  budget: budgets,
  categoryName: categories.name,
  categoryIcon: categories.icon,
};

export type BudgetRow = {
  budget: typeof budgets.$inferSelect;
  categoryName: string | null;
  categoryIcon: string | null;
};

function viewQuery() {
  // Left join: the overall budget has no category, and a category tombstoned on
  // another device must not make its historical budget disappear.
  return db
    .select(budgetView)
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id));
}

export function getBudgets(): BudgetRow[] {
  return viewQuery()
    .where(live)
    .orderBy(...budgetOrder)
    .all();
}

export function getBudgetById(id: number): BudgetRow | null {
  return (
    viewQuery()
      .where(and(live, eq(budgets.id, id)))
      .get() ?? null
  );
}

export function getBudgetsForMonth(periodMonth: PeriodMonth): BudgetRow[] {
  return viewQuery()
    .where(and(live, eq(budgets.periodMonth, periodMonth)))
    .orderBy(...budgetOrder)
    .all();
}

export function getBudgetsForMonthAndCurrency(
  periodMonth: PeriodMonth,
  currency: string,
): BudgetRow[] {
  return viewQuery()
    .where(and(live, eq(budgets.periodMonth, periodMonth), eq(budgets.currency, currency)))
    .orderBy(...budgetOrder)
    .all();
}

/**
 * Every budget across several months, in one currency, in one query.
 *
 * A report covering six months asks for all six at once rather than a query per
 * month. `inArray` on an empty list is not valid SQL, so nothing is asked when
 * there is nothing to ask about.
 */
export function getBudgetsForMonthsAndCurrency(
  periodMonths: PeriodMonth[],
  currency: string,
): BudgetRow[] {
  if (periodMonths.length === 0) return [];
  return viewQuery()
    .where(and(live, inArray(budgets.periodMonth, periodMonths), eq(budgets.currency, currency)))
    .orderBy(...budgetOrder)
    .all();
}

/**
 * The one live budget for a month, currency and category, if it exists.
 *
 * This is the duplicate rule expressed as a read. The database enforces the same
 * thing with a partial unique index, including for the overall budget, whose
 * null category would otherwise be distinct from every other null.
 */
export function findLiveBudget(
  periodMonth: PeriodMonth,
  currency: string,
  categoryId: number | null,
) {
  return (
    db
      .select()
      .from(budgets)
      .where(
        and(
          live,
          eq(budgets.periodMonth, periodMonth),
          eq(budgets.currency, currency),
          categoryId === null ? isNull(budgets.categoryId) : eq(budgets.categoryId, categoryId),
        ),
      )
      .get() ?? null
  );
}

/** Live budgets referencing one category, in any month. */
export function getBudgetsForCategory(categoryId: number) {
  return db
    .select()
    .from(budgets)
    .where(and(live, eq(budgets.categoryId, categoryId)))
    .orderBy(...budgetOrder)
    .all();
}

export function createBudget(data: CreateBudgetRecord) {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const budget = tx
      .insert(budgets)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, { entityType: 'budget', entitySyncId: syncId, operation: 'upsert' });
    return budget;
  });
}

export function updateBudget(id: number, data: UpdateBudgetRecord) {
  return db.transaction((tx) => {
    const budget =
      tx
        .update(budgets)
        .set(data)
        .where(and(live, eq(budgets.id, id)))
        .returning()
        .get() ?? null;
    if (budget === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'budget',
      entitySyncId: requireSyncId(budget.syncId, 'budget'),
      operation: 'upsert',
    });
    return budget;
  });
}

/**
 * Deletion is a tombstone, like every other syncable row: the record keeps its
 * global identity so the deletion can reach other devices, and every budget
 * query hides it immediately. It removes a plan and nothing else — no
 * transaction, category or account is touched.
 */
export function deleteBudget(id: number, deletedAt = new Date()) {
  return db.transaction((tx) => {
    const budget =
      tx
        .update(budgets)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(live, eq(budgets.id, id)))
        .returning()
        .get() ?? null;
    if (budget === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'budget',
      entitySyncId: requireSyncId(budget.syncId, 'budget'),
      operation: 'delete',
    });
    return budget;
  });
}

/**
 * What was actually spent in a month, grouped by category, in one query.
 *
 * Only `expense` counts. Income adds nothing to a spending plan; a transfer
 * moves money between the user's own accounts and spends none of it; and
 * lending, borrowing and repayments change what is owed rather than what was
 * consumed. Each of those has its own place in the app, and none of them belongs
 * in a budget.
 *
 * Every budget for a month is answered from this one aggregate rather than a
 * query each, so a month with a hundred budgets still reads the transaction
 * table once.
 */
export function getMonthlyExpenseTotalsByCategory(
  range: MonthRange,
  currency: string,
): { categoryId: number | null; amountMinor: number }[] {
  return db
    .select({
      categoryId: transactions.categoryId,
      amountMinor: sql<number>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(expenseIn(range, currency))
    .groupBy(transactions.categoryId)
    .all();
}

/**
 * The same expenses across a span of months, still in one query.
 *
 * Rows come back per financial date and category; the caller drops each into
 * its local calendar month. Bucketing here would mean asking SQLite to decide
 * which calendar month an instant belongs to, and its answer would depend on
 * the connection's time zone rather than on the device's — which is precisely
 * the disagreement `period_month` exists to avoid. So SQLite sums, and the
 * calendar stays where the rest of the calendar logic lives.
 */
export function getExpenseTotalsByDateAndCategory(
  range: MonthRange,
  currency: string,
): { transactionDate: Date; categoryId: number | null; amountMinor: number }[] {
  return db
    .select({
      transactionDate: transactions.transactionDate,
      categoryId: transactions.categoryId,
      amountMinor: sql<number>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(expenseIn(range, currency))
    .groupBy(transactions.transactionDate, transactions.categoryId)
    .all();
}

/** The same aggregate for one budget: all expenses, or one category's. */
export function getMonthlyExpenseTotal(
  range: MonthRange,
  currency: string,
  categoryId: number | null,
): number {
  const result = db
    .select({ amountMinor: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(
      categoryId === null
        ? expenseIn(range, currency)
        : and(expenseIn(range, currency), eq(transactions.categoryId, categoryId)),
    )
    .get();
  return result?.amountMinor ?? 0;
}

/**
 * The month is matched on `transactionDate`, the date the money moved, never on
 * when the row happened to be written. An expense entered today for last month
 * belongs to last month's budget.
 *
 * The currency must match exactly. Amounts in different currencies are different
 * quantities, and this app performs no conversion, so a budget only ever counts
 * spending denominated the same way.
 */
function expenseIn(range: MonthRange, currency: string) {
  return and(
    eq(transactions.type, 'expense'),
    isNull(transactions.deletedAt),
    eq(transactions.currency, currency),
    gte(transactions.transactionDate, range.start),
    lt(transactions.transactionDate, range.end),
  );
}

/** Live budgets, for the reconciliation "does this device hold anything" question. */
export function countLiveBudgets(): number {
  return (
    db
      .select({ total: sql<number>`count(*)` })
      .from(budgets)
      .where(live)
      .get()?.total ?? 0
  );
}
