import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  id: int('id').primaryKey(),
  defaultCurrency: text('default_currency').notNull(),
  createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
