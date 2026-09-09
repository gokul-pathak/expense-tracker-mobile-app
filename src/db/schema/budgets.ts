import { sql } from 'drizzle-orm';
import { check, index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { categories } from './categories';

/**
 * A spending plan for one calendar month.
 *
 * A budget is a planning record, not an accounting one. It creates no
 * transaction, moves no balance and is never counted as an expense. What was
 * actually spent is never stored here — it is derived from the expense
 * transactions of the month, every time it is asked for, so a budget cannot
 * drift out of step with the records it describes.
 *
 * `categoryId` null means the overall monthly budget: the plan for everything
 * spent that month, independent of the per-category plans rather than a total of
 * them.
 *
 * `periodMonth` is `YYYY-MM`. A month is an identity, not an instant, so storing
 * a timestamp would make two devices in different time zones disagree about
 * which month a budget belongs to. The calendar range it stands for is computed
 * locally where it is used.
 */
export const budgets = sqliteTable(
  'budgets',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    /** Null is the overall monthly budget. Otherwise an expense category. */
    categoryId: int('category_id').references(() => categories.id),
    periodMonth: text('period_month').notNull(),
    amountMinor: int('amount_minor').notNull(),
    currency: text('currency').notNull(),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('budget_amount_positive', sql`\`amount_minor\` > 0`),
    check(
      'valid_budget_period_month',
      sql`\`period_month\` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(\`period_month\`, 6, 2) BETWEEN '01' AND '12'`,
    ),
    uniqueIndex('uq_budgets_sync_id').on(t.syncId),
    index('idx_budget_period_month').on(t.periodMonth),
    index('idx_budget_category_id').on(t.categoryId),
  ],
  // One further index exists only in the migration, because it cannot be
  // expressed here: a partial unique index over `coalesce(category_id, -1)`,
  // which is what makes the overall budget's null category collide with itself.
  // SQLite treats distinct nulls as distinct in a unique index, so without the
  // coalesce a month could hold any number of overall budgets.
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
