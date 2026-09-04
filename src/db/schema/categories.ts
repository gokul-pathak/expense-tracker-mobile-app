import { sql } from 'drizzle-orm';
import { int, sqliteTable, text, check, unique } from 'drizzle-orm/sqlite-core';

import { CATEGORY_TYPES, type CategoryType } from '../constants';

const categoryTypeList = CATEGORY_TYPES.map((v) => `'${v}'`).join(', ');

export const categories = sqliteTable(
  'categories',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type').notNull().$type<CategoryType>(),
    icon: text('icon'),
    systemKey: text('system_key'),
    isDefault: int('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('valid_category_type', sql`\`type\` IN (${sql.raw(categoryTypeList)})`),
    unique('uq_category_system_key').on(t.systemKey),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
