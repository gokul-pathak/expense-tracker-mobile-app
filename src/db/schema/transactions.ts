import { sql } from 'drizzle-orm';
import { int, sqliteTable, text, check, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { TRANSACTION_TYPES, type TransactionType, type PaymentMode } from '../constants';

import { categories } from './categories';
import { accounts } from './accounts';
import { people } from './people';
import { recurringOccurrences } from './recurring';

const txTypeList = TRANSACTION_TYPES.map((v) => `'${v}'`).join(', ');

export const transactions = sqliteTable(
  'transactions',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull().$type<TransactionType>(),
    amountMinor: int('amount_minor').notNull(),
    currency: text('currency').notNull(),
    categoryId: int('category_id').references(() => categories.id),
    sourceAccountId: int('source_account_id').references(() => accounts.id),
    destinationAccountId: int('destination_account_id').references(() => accounts.id),
    personId: int('person_id').references(() => people.id),
    paymentMode: text('payment_mode').$type<PaymentMode>(),
    transactionDate: int('transaction_date', { mode: 'timestamp_ms' }).notNull(),
    title: text('title').notNull(),
    note: text('note'),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
    /**
     * The recurring occurrence this transaction was generated for, or null for
     * every transaction a person entered by hand.
     *
     * Provenance only. A generated transaction is an ordinary transaction in
     * every calculation, and editing or deleting its template never touches it.
     * The link lives here, on the child, rather than on the occurrence, so the
     * two rows cannot disagree about each other and neither needs the other to
     * exist first.
     */
    recurringOccurrenceId: int('recurring_occurrence_id').references(() => recurringOccurrences.id),
  },
  (t) => [
    check('valid_transaction_type', sql`\`type\` IN (${sql.raw(txTypeList)})`),
    check('amount_positive', sql`\`amount_minor\` > 0`),
    check(
      'transfer_different_accounts',
      sql`\`source_account_id\` IS NULL OR \`destination_account_id\` IS NULL OR \`source_account_id\` <> \`destination_account_id\``,
    ),
    index('idx_tx_transaction_date').on(t.transactionDate),
    index('idx_tx_type').on(t.type),
    index('idx_tx_category_id').on(t.categoryId),
    index('idx_tx_source_account_id').on(t.sourceAccountId),
    index('idx_tx_destination_account_id').on(t.destinationAccountId),
    index('idx_tx_person_id').on(t.personId),
    // One transaction per occurrence. SQLite lets any number of rows share a
    // null here, which is every manually entered transaction.
    uniqueIndex('uq_tx_recurring_occurrence').on(t.recurringOccurrenceId),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
