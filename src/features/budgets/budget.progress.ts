import type { BudgetRow } from './budget.repository';
import type { BudgetProgress, BudgetStatus } from './budget.types';

/**
 * The arithmetic, in one place.
 *
 * Money stays in integer minor units throughout. The percentage is the only
 * floating-point value, and it is display-only: it is derived from the integers
 * and never feeds back into one.
 *
 * This lives apart from the service because the monthly engine and the
 * multi-month report comparison both need the same reading of "how does this
 * stand", and two copies of it would eventually disagree about the one case
 * that matters — spending exactly to the limit.
 */
export function toBudgetProgress(row: BudgetRow, spentMinor: number): BudgetProgress {
  const amountMinor = row.budget.amountMinor;
  const remainingMinor = amountMinor - spentMinor;
  return {
    budget: row.budget,
    categoryName: row.categoryName ?? null,
    categoryIcon: row.categoryIcon ?? null,
    spentMinor,
    remainingMinor,
    overspentMinor: Math.max(0, -remainingMinor),
    // Uncapped on purpose: 125% is the true reading, and a bar that stops at
    // 100% is a presentation choice, not a fact about the month.
    percentage: (spentMinor / amountMinor) * 100,
    status: budgetStatusOf(spentMinor, amountMinor),
  };
}

/**
 * Four states, and the boundary between the last two is exact.
 *
 * Spending precisely to the limit has reached it and not exceeded it. Treating
 * equality as overspending would tell someone they had gone over when they had
 * done exactly what they planned.
 */
export function budgetStatusOf(spentMinor: number, amountMinor: number): BudgetStatus {
  if (spentMinor === 0) return 'unused';
  if (spentMinor < amountMinor) return 'within_budget';
  if (spentMinor === amountMinor) return 'at_budget';
  return 'over_budget';
}
