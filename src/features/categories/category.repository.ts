import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import type { CategoryType } from '@/db/constants';
import { categories } from '@/db/schema/categories';

import type { CreateCategoryRecord, UpdateCategoryRecord } from './category.types';

export function getCategories() {
  return db.select().from(categories).orderBy(asc(categories.id)).all();
}

export function getCategoryById(id: number) {
  return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
}

export function getCategoriesByType(type: CategoryType) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.type, type))
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
  return db.insert(categories).values(data).returning().get();
}

export function updateCategory(id: number, data: UpdateCategoryRecord) {
  return db.update(categories).set(data).where(eq(categories.id, id)).returning().get() ?? null;
}
