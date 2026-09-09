import * as settingsRepository from '@/features/settings/settings.repository';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

import { monthRange, type PeriodMonth } from './budget.period';
import * as repository from './budget.repository';
import type { BudgetRow } from './budget.repository';
import type {
  Budget,
  BudgetProgress,
  BudgetStatus,
  CreateBudgetInput,
  MonthlyBudgetSummary,
  UpdateBudgetInput,
  UpdateBudgetRecord,
} from './budget.types';
import {
  assertBudgetableCategory,
  assertNoDuplicateBudget,
  normalizeAmountMinor,
  normalizeCategoryId,
  normalizeCurrency,
  normalizePeriodMonth,
} from './budget.validation';

/**
 * The budget engine.
 *
 * It answers four questions — what was planned, what was spent, what remains,
 * and what went over — and it answers them from source records every time.
 * Nothing here writes a spending figure anywhere: creating a budget writes one
 * planning row and changes no balance, no transaction and no report.
 *
 * The figures are facts. `over_budget` is arithmetic, not a judgement, and this
 * module deliberately produces no advice about it.
 */

export function listBudgets(): Budget[] {
  return repository.getBudgets().map((row) => row.budget);
}

export function getBudget(id: number): Budget {
  return (repository.getBudgetById(id) ?? notFound(id)).budget;
}

/** Every live budget for a month, across all currencies. */
export function listBudgetsForMonth(month: PeriodMonth | Date): Budget[] {
  return repository.getBudgetsForMonth(normalizePeriodMonth(month)).map((row) => row.budget);
}

export function createBudget(input: CreateBudgetInput): Budget {
  const periodMonth = normalizePeriodMonth(input.periodMonth);
  const amountMinor = normalizeAmountMinor(input.amountMinor);
  const currency = normalizeCurrency(input.currency ?? defaultCurrency());
  const categoryId = normalizeCategoryId(input.categoryId);

  if (categoryId !== null) assertBudgetableCategory(categoryId);
  assertNoDuplicateBudget(periodMonth, currency, categoryId);

  const now = new Date();
  return repository.createBudget({
    categoryId,
    periodMonth,
    amountMinor,
    currency,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Editing a budget changes the plan, never the record of what happened. Moving a
 * budget to a different month or category does not move a single transaction; it
 * changes which spending the plan is compared against, and the comparison is
 * recomputed from scratch.
 */
export function updateBudget(id: number, input: UpdateBudgetInput): Budget {
  const current = getBudget(id);
  const data = normalizeUpdate(input);

  const periodMonth = data.periodMonth ?? current.periodMonth;
  const currency = data.currency ?? current.currency;
  const categoryId = data.categoryId === undefined ? current.categoryId : data.categoryId;

  // Only a category the budget is moving *to* is re-checked. A budget already
  // filed under a category that has since been deleted may still have its amount
  // corrected.
  if (categoryId !== null && categoryId !== current.categoryId) {
    assertBudgetableCategory(categoryId);
  }
  assertNoDuplicateBudget(periodMonth, currency, categoryId, id);

  return repository.updateBudget(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

export function deleteBudget(id: number): Budget {
  return repository.deleteBudget(id) ?? notFound(id);
}

/** One budget measured against the spending it covers. */
export function getBudgetProgress(id: number): BudgetProgress {
  const row = repository.getBudgetById(id) ?? notFound(id);
  const spentMinor = repository.getMonthlyExpenseTotal(
    monthRange(row.budget.periodMonth),
    row.budget.currency,
    row.budget.categoryId,
  );
  return toProgress(row, spentMinor);
}

/**
 * A month's plan in one currency.
 *
 * Every budget in the month is answered from a single grouped aggregate, so the
 * cost is one pass over the month's expenses however many budgets there are —
 * not one scan per budget, and never a scan in JavaScript.
 */
export function getMonthlyBudgetSummary(
  month: PeriodMonth | Date,
  currency?: string,
): MonthlyBudgetSummary {
  const periodMonth = normalizePeriodMonth(month);
  const resolvedCurrency = normalizeCurrency(currency ?? defaultCurrency());
  const rows = repository.getBudgetsForMonthAndCurrency(periodMonth, resolvedCurrency);

  const totals = repository.getMonthlyExpenseTotalsByCategory(
    monthRange(periodMonth),
    resolvedCurrency,
  );
  const byCategory = new Map<number, number>();
  let totalSpentMinor = 0;
  for (const total of totals) {
    totalSpentMinor += total.amountMinor;
    if (total.categoryId !== null) byCategory.set(total.categoryId, total.amountMinor);
  }

  const overallRow = rows.find((row) => row.budget.categoryId === null) ?? null;
  const categoryRows = rows.filter((row) => row.budget.categoryId !== null);

  const overallBudget = overallRow === null ? null : toProgress(overallRow, totalSpentMinor);
  const categoryBudgets = categoryRows.map((row) =>
    toProgress(row, byCategory.get(row.budget.categoryId!) ?? 0),
  );
  const categoryBudgetedMinor = categoryBudgets.reduce(
    (total, progress) => total + progress.budget.amountMinor,
    0,
  );

  return {
    month: periodMonth,
    currency: resolvedCurrency,
    overallBudget,
    categoryBudgets,
    categoryBudgetedMinor,
    // The overall budget is the month's limit when it exists. Adding the
    // category budgets to it would count the same plan twice: an overall budget
    // already covers the spending each category budget covers.
    totalBudgetedMinor:
      overallBudget !== null
        ? overallBudget.budget.amountMinor
        : categoryBudgets.length === 0
          ? null
          : categoryBudgetedMinor,
    totalSpentMinor,
  };
}

/**
 * The arithmetic, in one place.
 *
 * Money stays in integer minor units throughout. The percentage is the only
 * floating-point value, and it is display-only: it is derived from the integers
 * and never feeds back into one.
 */
function toProgress(row: BudgetRow, spentMinor: number): BudgetProgress {
  const amountMinor = row.budget.amountMinor;
  const remainingMinor = amountMinor - spentMinor;
  return {
    budget: row.budget,
    categoryName: row.categoryName ?? null,
    spentMinor,
    remainingMinor,
    overspentMinor: Math.max(0, -remainingMinor),
    // Uncapped on purpose: 125% is the true reading, and a bar that stops at
    // 100% is a presentation choice, not a fact about the month.
    percentage: (spentMinor / amountMinor) * 100,
    status: statusOf(spentMinor, amountMinor),
  };
}

function statusOf(spentMinor: number, amountMinor: number): BudgetStatus {
  if (spentMinor === 0) return 'unused';
  if (spentMinor < amountMinor) return 'within_budget';
  if (spentMinor === amountMinor) return 'at_budget';
  return 'over_budget';
}

function normalizeUpdate(input: UpdateBudgetInput): Omit<UpdateBudgetRecord, 'updatedAt'> {
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one budget field to update.');
  }

  const data: Omit<UpdateBudgetRecord, 'updatedAt'> = {};
  if (input.amountMinor !== undefined) data.amountMinor = normalizeAmountMinor(input.amountMinor);
  if (input.periodMonth !== undefined) data.periodMonth = normalizePeriodMonth(input.periodMonth);
  if (input.currency !== undefined) data.currency = normalizeCurrency(input.currency);
  if (input.categoryId !== undefined) data.categoryId = normalizeCategoryId(input.categoryId);

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Provide at least one permitted budget field to update.');
  }
  return data;
}

function defaultCurrency(): string {
  const settings = settingsRepository.getSettings();
  if (settings === null || settings === undefined) {
    throw new NotFoundError('Application settings were not found.');
  }
  return settings.defaultCurrency;
}

function notFound(id: number): never {
  throw new NotFoundError(`Budget ${id} was not found.`);
}
