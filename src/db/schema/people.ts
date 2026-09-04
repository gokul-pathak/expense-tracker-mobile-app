import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const people = sqliteTable('people', {
  id: int('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  note: text('note'),
  isArchived: int('is_archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
