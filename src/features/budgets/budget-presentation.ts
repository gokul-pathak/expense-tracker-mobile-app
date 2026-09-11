import { formatMinorUnits, splitMinorUnits } from '@/utils/money';

import { formatPeriodMonth, normalizePeriodMonth, type PeriodMonth } from './budget.period';
import type { BudgetProgress } from './budget.types';

/**
 * How a budget reads, kept apart from how it is drawn.
 *
 * Every string a budget screen shows comes from here, for two reasons. The
 * screens are not testable in this suite — the runner only collects `.ts` — so
 * anything with a rule in it has to live where a test can reach it. And the same
 * sentence appears on the budgets screen, on Home and in Reports; written three
 * times it would drift three ways.
 *
 * The register is the app's: factual, never advisory. "Over budget" is a
 * measurement. Nothing here suggests what to do about it.
 */

/**
 * Over budget first, then whoever is closest to it, then alphabetically.
 *
 * Deterministic to the last tie-break on purpose: a list that reorders between
 * two renders of the same data reads as a bug, and the id is the only value
 * guaranteed to differ when everything else matches. Sorting a copy keeps the
 * service's own array untouched.
 */
export function sortBudgetProgress(items: BudgetProgress[]): BudgetProgress[] {
  return [...items].sort((left, right) => {
    const byStatus = Number(isOverBudget(right)) - Number(isOverBudget(left));
    if (byStatus !== 0) return byStatus;
    if (right.percentage !== left.percentage) return right.percentage - left.percentage;
    const byName = categoryLabel(left).localeCompare(categoryLabel(right));
    if (byName !== 0) return byName;
    return left.budget.id - right.budget.id;
  });
}

/**
 * The category budgets Home has room for: whatever is over budget first, then
 * whatever is nearest to it.
 *
 * Home shows a handful and says so; it is not a second budgets screen.
 */
export function pickBudgetHighlights(items: BudgetProgress[], limit = 3): BudgetProgress[] {
  return sortBudgetProgress(items).slice(0, Math.max(limit, 0));
}

export function isOverBudget(progress: BudgetProgress): boolean {
  return progress.status === 'over_budget';
}

/**
 * The true percentage, at most two decimals, with trailing zeros dropped.
 *
 * Never capped: 125% is what the month actually did, and a figure that stops at
 * 100 hides exactly the thing an overspent user needs. Two decimals is where the
 * milestone's own worked examples land (48.75%, 113.33%) while whole values stay
 * whole — the raw ratio is a float and would otherwise print sixteen digits.
 */
export function formatBudgetPercentage(percentage: number): string {
  if (!Number.isFinite(percentage)) return '—';
  const rounded = Math.round(percentage * 100) / 100;
  return trimZeros(rounded.toFixed(2)) + '%';
}

/**
 * The same figure as a whole number, for somewhere with no room for decimals —
 * the middle of the overall ring, where the precise value sits beside it as text.
 */
export function formatBudgetPercentageCompact(percentage: number): string {
  if (!Number.isFinite(percentage)) return '—';
  return Math.round(percentage) + '%';
}

/**
 * What state this budget is in, as words rather than as a colour.
 *
 * Colour alone cannot be read by everyone who uses the app, so every state that
 * a hue would signal is also stated. Four states, matching the engine's four.
 */
export function getBudgetStatusLabel(progress: BudgetProgress): string {
  switch (progress.status) {
    case 'unused':
      return 'No spending yet';
    case 'within_budget':
      return 'Within budget';
    case 'at_budget':
      return 'Budget reached';
    case 'over_budget':
      return 'Over budget';
  }
}

/**
 * How much room is left, said in the direction it actually runs.
 *
 * "NPR 2,000.00 over budget", never "−NPR 2,000.00 remaining" — a negative
 * remainder is arithmetically true and reads as nonsense. Spending exactly to
 * the limit is reported as reaching it, not as exceeding it.
 *
 * `code: false` drops the currency code for a screen that has already said
 * which currency it is showing. The sentence is written once either way, so the
 * spoken label and the printed one cannot drift apart.
 */
export function getBudgetRemainderLabel(
  progress: BudgetProgress,
  options?: { code?: boolean },
): string {
  const currency = progress.budget.currency;
  const code = options?.code ?? true;
  if (progress.status === 'over_budget') {
    return amount(progress.overspentMinor, currency, code) + ' over budget';
  }
  if (progress.status === 'at_budget') return 'Budget reached';
  return amount(progress.remainingMinor, currency, code) + ' remaining';
}

/** "NPR 9,000.00 of NPR 15,000.00". The plan and what has gone against it. */
export function getBudgetSpendLabel(
  progress: BudgetProgress,
  options?: { code?: boolean },
): string {
  const currency = progress.budget.currency;
  const code = options?.code ?? true;
  return (
    amount(progress.spentMinor, currency, code) +
    ' of ' +
    amount(progress.budget.amountMinor, currency, code)
  );
}

/**
 * One row read aloud in full: what it covers, the plan, the gap, the share used.
 *
 * A screen reader reaches a budget row as a single element, so the label has to
 * carry everything the sighted layout carries — the bar included, since its
 * width says nothing out loud.
 */
export function getBudgetAccessibilityLabel(progress: BudgetProgress): string {
  return (
    budgetName(progress) +
    ', ' +
    getBudgetSpendLabel(progress) +
    ' spent, ' +
    getBudgetRemainderLabel(progress) +
    ', ' +
    formatBudgetPercentage(progress.percentage) +
    ' of budget spent.'
  );
}

/** What the bar itself is worth, for a progress indicator read on its own. */
export function getBudgetProgressAccessibilityLabel(progress: BudgetProgress): string {
  return formatBudgetPercentage(progress.percentage) + ' of budget spent';
}

/** "Food budget", or "Monthly budget" for the overall plan. */
export function budgetName(progress: BudgetProgress): string {
  if (progress.budget.categoryId === null) return 'Monthly budget';
  return categoryLabel(progress) + ' budget';
}

/**
 * The category's current name.
 *
 * A budget whose category was deleted on this or another device keeps its row
 * and stays identifiable rather than rendering as a blank relation — deleting a
 * category is not a reason to erase what was planned under it.
 */
export function categoryLabel(progress: BudgetProgress): string {
  if (progress.budget.categoryId === null) return 'Everything';
  return progress.categoryName ?? 'Deleted category';
}

/** "September 2026". */
export function getMonthLabel(month: PeriodMonth): string {
  const { year, index } = monthParts(month);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, index, 1),
  );
}

/** "September", for a sentence that already names the year or does not need it. */
export function getShortMonthLabel(month: PeriodMonth): string {
  const { year, index } = monthParts(month);
  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(year, index, 1));
}

/**
 * The month `delta` steps away. December rolls into January on its own because
 * the local `Date` constructor normalizes an out-of-range month index.
 */
export function stepPeriodMonth(month: PeriodMonth, delta: number): PeriodMonth {
  const { year, index } = monthParts(month);
  return formatPeriodMonth(new Date(year, index + delta, 1));
}

/** The month a budget screen opens on: the one the user is living in. */
export function currentPeriodMonth(now = new Date()): PeriodMonth {
  return formatPeriodMonth(now);
}

/**
 * A duplicate said in the user's terms.
 *
 * The service already refuses the write and says why; this turns its sentence
 * into one that names the way out. Which budget already exists is the useful
 * part — "it failed" is not.
 */
export function describeBudgetConflict(
  message: string,
  context: { month: PeriodMonth; overall: boolean; categoryName?: string | null },
): string {
  if (!/already/i.test(message)) return message;
  const monthName = getShortMonthLabel(context.month);
  if (context.overall) {
    return 'An overall budget already exists for ' + monthName + '. Edit that one instead.';
  }
  const name = context.categoryName?.trim();
  return (
    'A ' +
    (name ? name + ' ' : '') +
    'budget already exists for ' +
    monthName +
    '. Edit that one instead.'
  );
}

/** Grouped and to two decimals, with the currency code only when it is wanted. */
function amount(minorUnits: number, currency: string, code: boolean): string {
  if (code) return formatMinorUnits(minorUnits, currency);
  const parts = splitMinorUnits(minorUnits, currency);
  return (parts.negative ? '-' : '') + parts.integer + '.' + parts.decimals;
}

function monthParts(month: PeriodMonth) {
  const normalized = normalizePeriodMonth(month);
  return { year: Number(normalized.slice(0, 4)), index: Number(normalized.slice(5, 7)) - 1 };
}

function trimZeros(fixed: string): string {
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
