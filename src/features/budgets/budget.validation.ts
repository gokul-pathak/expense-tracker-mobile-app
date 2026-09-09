import * as categoryRepository from '@/features/categories/category.repository';
import { ConflictError, ValidationError } from '@/features/shared/errors';

import { normalizePeriodMonth, type PeriodMonth } from './budget.period';
import * as repository from './budget.repository';

/**
 * What makes a budget well-formed, kept apart from what a budget is for.
 *
 * Two of these rules exist to stop a budget meaning something the app cannot
 * honour: a plan for an income category would compare a limit against spending
 * that can never occur, and a plan whose currency differs from the expenses it
 * is meant to measure would silently count nothing at all.
 */

export function normalizeAmountMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationError('Budget amount must be a safe integer number of minor units.');
  }
  if (value <= 0) {
    throw new ValidationError('Budget amount must be greater than zero.');
  }
  return value;
}

export function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('Budget currency is required.');
  }
  return value.trim().toUpperCase();
}

export { normalizePeriodMonth };

/** Null is the overall monthly budget and needs no category at all. */
export function normalizeCategoryId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Budget category is invalid.');
  }
  return value;
}

/**
 * A category a new budget may be filed under.
 *
 * Only expense categories: a budget is a spending limit, and an income category
 * has no spending to limit. A category deleted on this or another device is
 * refused too, by the same rule that keeps it out of every other picker — while
 * a budget that already references one stays readable, because deleting a
 * category is not a reason to erase the history of what was planned.
 */
export function assertBudgetableCategory(categoryId: number): void {
  const category = categoryRepository.getCategoryById(categoryId);
  if (category === null) {
    throw new ValidationError('Budget category was not found.');
  }
  if (category.type !== 'expense') {
    throw new ValidationError('Only expense categories can have a budget.');
  }
}

/**
 * One live budget per month, currency and category.
 *
 * Two budgets for the same thing have no meaningful reading: neither is the
 * plan, and their sum is a number the user never chose. The database enforces
 * this too, so a race cannot slip past this check.
 */
export function assertNoDuplicateBudget(
  periodMonth: PeriodMonth,
  currency: string,
  categoryId: number | null,
  ignoredId?: number,
): void {
  const existing = repository.findLiveBudget(periodMonth, currency, categoryId);
  if (existing === null || existing.id === ignoredId) return;
  throw new ConflictError(
    categoryId === null
      ? `An overall ${currency} budget already exists for ${periodMonth}.`
      : `A ${currency} budget for that category already exists for ${periodMonth}.`,
  );
}
