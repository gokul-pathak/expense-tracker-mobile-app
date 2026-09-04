import { sql } from 'drizzle-orm';
import { int, sqliteTable, text, check } from 'drizzle-orm/sqlite-core';

import { ACCOUNT_TYPES, type AccountType } from '../constants';

const accountTypeList = ACCOUNT_TYPES.map((v) => `'${v}'`).join(', ');

export const accounts = sqliteTable(
  'accounts',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type').notNull().$type<AccountType>(),
    openingBalanceMinor: int('opening_balance_minor').notNull().default(0),
    currency: text('currency').notNull(),
    icon: text('icon'),
    isArchived: int('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [check('valid_account_type', sql`\`type\` IN (${sql.raw(accountTypeList)})`)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
