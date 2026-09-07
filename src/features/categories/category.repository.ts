import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import type { CategoryType } from '@/db/constants';
import { categories } from '@/db/schema/categories';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import type { CreateCategoryRecord, UpdateCategoryRecord } from './category.types';

const live = isNull(categories.deletedAt);

export function getCategories() {
  return db.select().from(categories).where(live).orderBy(asc(categories.id)).all();
}

export function getCategoryById(id: number) {
  return (
    db
      .select()
      .from(categories)
      .where(and(live, eq(categories.id, id)))
      .get() ?? null
  );
}

export function getCategoriesByType(type: CategoryType) {
  return db
    .select()
    .from(categories)
    .where(and(live, eq(categories.type, type)))
    .orderBy(asc(categories.id))
    .all();
}

export function getExpenseCategories() {
  return getCategoriesByType('expense');
}

export function getIncomeCategories() {
  return getCategoriesByType('income');
}

export function createCategory(data: CreateCategoryRecord) {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const category = tx
      .insert(categories)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'category',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return category;
  });
}

export function updateCategory(id: number, data: UpdateCategoryRecord) {
  return db.transaction((tx) => {
    const category =
      tx
        .update(categories)
        .set(data)
        .where(and(live, eq(categories.id, id)))
        .returning()
        .get() ?? null;
    if (category === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'category',
      entitySyncId: requireSyncId(category.syncId, 'category'),
      operation: 'upsert',
    });
    return category;
  });
}
