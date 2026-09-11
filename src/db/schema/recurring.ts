import { sql } from 'drizzle-orm';
import { check, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import {
  MAX_RECURRENCE_INTERVAL,
  RECURRING_FREQUENCIES,
  RECURRING_OCCURRENCE_STATUSES,
  RECURRING_TRANSACTION_TYPES,
  type PaymentMode,
  type RecurringFrequency,
  type RecurringOccurrenceStatus,
  type RecurringTransactionType,
} from '../constants';

import { accounts } from './accounts';
import { categories } from './categories';

const typeList = RECURRING_TRANSACTION_TYPES.map((value) => `'${value}'`).join(', ');
const frequencyList = RECURRING_FREQUENCIES.map((value) => `'${value}'`).join(', ');
const statusList = RECURRING_OCCURRENCE_STATUSES.map((value) => `'${value}'`).join(', ');
const LOCAL_DATE_GLOB = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

/**
 * A plan to record the same expense or income on a schedule.
 *
 * A template is not a transaction and has no financial effect of any kind: no
 * balance, report, budget or receivable ever reads this table. Only a
 * transaction generated from it counts, and that transaction is an ordinary row
 * in `transactions`, indistinguishable in every calculation from one a person
 * typed in.
 *
 * `accountId` means what it means on the transaction it produces: the source
 * account of an expense, the destination account of an income. `currency` is
 * the account's, recorded so a template whose account has since changed
 * currency is refused at generation rather than silently converted.
 *
 * Dates are `YYYY-MM-DD` calendar text, never instants. See `recurring-schedule.ts`.
 */
export const recurringTemplates = sqliteTable(
  'recurring_templates',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull().$type<RecurringTransactionType>(),
    amountMinor: int('amount_minor').notNull(),
    currency: text('currency').notNull(),
    categoryId: int('category_id')
      .notNull()
      .references(() => categories.id),
    accountId: int('account_id')
      .notNull()
      .references(() => accounts.id),
    paymentMode: text('payment_mode').$type<PaymentMode>(),
    /** Copied into each generated transaction's title. Empty is allowed, as it is there. */
    title: text('title').notNull(),
    note: text('note'),
    /** The first scheduled occurrence. */
    startDate: text('start_date').notNull(),
    frequency: text('frequency').notNull().$type<RecurringFrequency>(),
    /** "Every N" units of `frequency`. `interval` is reserved in PostgreSQL, hence the column name. */
    interval: int('interval_count').notNull(),
    /** Inclusive. Null repeats until the template is paused or deleted. */
    endDate: text('end_date'),
    isPaused: int('is_paused', { mode: 'boolean' }).notNull().default(false),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('valid_recurring_type', sql`\`type\` IN (${sql.raw(typeList)})`),
    check('recurring_amount_positive', sql`\`amount_minor\` > 0`),
    check('valid_recurring_frequency', sql`\`frequency\` IN (${sql.raw(frequencyList)})`),
    check(
      'valid_recurring_interval',
      sql`\`interval_count\` BETWEEN 1 AND ${sql.raw(String(MAX_RECURRENCE_INTERVAL))}`,
    ),
    check('valid_recurring_start_date', sql`\`start_date\` GLOB ${sql.raw(LOCAL_DATE_GLOB)}`),
    check(
      'valid_recurring_end_date',
      sql`\`end_date\` IS NULL OR (\`end_date\` GLOB ${sql.raw(LOCAL_DATE_GLOB)} AND \`end_date\` >= \`start_date\`)`,
    ),
    uniqueIndex('uq_recurring_templates_sync_id').on(t.syncId),
  ],
);

/**
 * A decision about one scheduled date: it was generated, or it was skipped.
 *
 * Only decisions are stored. A date nobody has handled yet has no row — it is
 * derived from the template's schedule minus these rows, every time — so the
 * table never fills with dates that have not happened.
 *
 * The identity of a row is not random. It is derived from the template's
 * identity and the date (see `recurring-identity.ts`), so two devices that
 * handle the same date offline produce the same row, and the cloud converges on
 * one. That is also why `(template_id, occurrence_date)` is unique outright
 * rather than only among live rows: there is exactly one identity per date, and
 * a retired row is revived rather than duplicated.
 */
export const recurringOccurrences = sqliteTable(
  'recurring_occurrences',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    templateId: int('template_id')
      .notNull()
      .references(() => recurringTemplates.id),
    occurrenceDate: text('occurrence_date').notNull(),
    status: text('status').notNull().$type<RecurringOccurrenceStatus>(),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('valid_recurring_occurrence_status', sql`\`status\` IN (${sql.raw(statusList)})`),
    check(
      'valid_recurring_occurrence_date',
      sql`\`occurrence_date\` GLOB ${sql.raw(LOCAL_DATE_GLOB)}`,
    ),
    uniqueIndex('uq_recurring_occurrences_sync_id').on(t.syncId),
    uniqueIndex('uq_recurring_occurrence_template_date').on(t.templateId, t.occurrenceDate),
  ],
);

export type RecurringTemplate = typeof recurringTemplates.$inferSelect;
export type NewRecurringTemplate = typeof recurringTemplates.$inferInsert;
export type RecurringOccurrence = typeof recurringOccurrences.$inferSelect;
export type NewRecurringOccurrence = typeof recurringOccurrences.$inferInsert;
