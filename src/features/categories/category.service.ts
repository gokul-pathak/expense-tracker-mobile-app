import { CATEGORY_TYPES, type CategoryType } from '@/db/constants';
import { ConflictError, NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './category.repository';
import type {
  CreateCategoryInput,
  CreateCategoryRecord,
  UpdateCategoryInput,
  UpdateCategoryRecord,
} from './category.types';

export function listCategories() {
  return repository.getCategories();
}

export function listExpenseCategories() {
  return repository.getExpenseCategories();
}

export function listIncomeCategories() {
  return repository.getIncomeCategories();
}

export function getCategory(id: number) {
  return repository.getCategoryById(id) ?? notFound(id);
}

export function createCategory(input: CreateCategoryInput) {
  const data = normalizeCreate(input);
  assertNoDuplicate(data.name, data.type);
  const now = new Date();
  return repository.createCategory({ ...data, createdAt: now, updatedAt: now });
}

export function updateCategory(id: number, input: UpdateCategoryInput) {
  const current = getCategory(id);
  const data = normalizeUpdate(input);
  assertNoDuplicate(data.name ?? current.name, data.type ?? current.type, id);
  return repository.updateCategory(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

function normalizeCreate(
  input: CreateCategoryInput,
): Omit<CreateCategoryRecord, 'createdAt' | 'updatedAt'> {
  return {
    name: normalizeRequiredText(input.name, 'Category name'),
    type: normalizeCategoryType(input.type),
    icon: normalizeOptionalText(input.icon),
    isDefault: false,
    systemKey: null,
  };
}

function normalizeUpdate(input: UpdateCategoryInput): Omit<UpdateCategoryRecord, 'updatedAt'> {
  const data: Omit<UpdateCategoryRecord, 'updatedAt'> = {};

  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one category field to update.');
  }
  if (input.name !== undefined) data.name = normalizeRequiredText(input.name, 'Category name');
  if (input.type !== undefined) data.type = normalizeCategoryType(input.type);
  if (input.icon !== undefined) data.icon = normalizeOptionalText(input.icon);

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Provide at least one permitted category field to update.');
  }

  return data;
}

function assertNoDuplicate(name: string, type: CategoryType, ignoredId?: number) {
  const normalizedName = name.toLowerCase();
  const duplicate = repository
    .getCategoriesByType(type)
    .find(
      (category) =>
        category.id !== ignoredId && category.name.trim().toLowerCase() === normalizedName,
    );

  if (duplicate) {
    throw new ConflictError(`A ${type} category named "${name}" already exists.`);
  }
}

function normalizeCategoryType(value: unknown): CategoryType {
  if (typeof value !== 'string' || !CATEGORY_TYPES.includes(value as CategoryType)) {
    throw new ValidationError('Category type is invalid.');
  }
  return value as CategoryType;
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError('Icon must be text.');
  return value.trim() || null;
}

function notFound(id: number): never {
  throw new NotFoundError(`Category ${id} was not found.`);
}
