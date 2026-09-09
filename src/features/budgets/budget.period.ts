import { PERIOD_MONTH_PATTERN } from '@/db/constants';
import { ValidationError } from '@/features/shared/errors';

/**
 * The month a budget plans for.
 *
 * A budget month is written `YYYY-MM` — an identity, not an instant. Two devices
 * in different time zones must agree on which month a budget belongs to, and a
 * stored timestamp would not: `2026-09-01T00:00+05:45` is still August in UTC.
 * So the identity is calendar text, and the instants it covers are computed on
 * whichever device is asking, in that device's local calendar.
 *
 * The range is half-open, `start <= transactionDate < end`, so no expense can
 * fall in two months and none can fall between them. Building it with the local
 * `Date` constructor gets February, leap years and year ends right without a
 * table of month lengths.
 */

export { PERIOD_MONTH_PATTERN };

export type PeriodMonth = string;

export type MonthRange = { start: Date; end: Date };

export function isPeriodMonth(value: unknown): value is PeriodMonth {
  return typeof value === 'string' && PERIOD_MONTH_PATTERN.test(value);
}

/**
 * Accepts what a caller plausibly has: the canonical `YYYY-MM`, a normalized
 * `YYYY-MM-01`, or a `Date` whose local calendar month is meant. Everything else
 * is rejected rather than guessed at — a budget filed under the wrong month is
 * silently wrong, and nothing later would reveal it.
 */
export function normalizePeriodMonth(value: unknown): PeriodMonth {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError('Budget month is not a valid date.');
    }
    return formatPeriodMonth(value);
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Budget month is required, as YYYY-MM.');
  }
  const trimmed = value.trim();
  // A day component is accepted only when it is the first of the month, so
  // `2026-09-17` is a mistake rather than a shorthand for September.
  const dated = /^(\d{4}-\d{2})-01$/.exec(trimmed);
  const candidate = dated === null ? trimmed : dated[1]!;
  if (!isPeriodMonth(candidate)) {
    throw new ValidationError(`Budget month "${value}" is not a valid YYYY-MM month.`);
  }
  return candidate;
}

/** The local calendar month containing an instant. */
export function formatPeriodMonth(date: Date): PeriodMonth {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * The half-open local range a month covers.
 *
 * `new Date(year, monthIndex + 1, 1)` rolls December into the next January on
 * its own, so year ends need no special case.
 */
export function monthRange(month: PeriodMonth): MonthRange {
  const normalized = normalizePeriodMonth(month);
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  return {
    start: new Date(year, monthIndex, 1),
    end: new Date(year, monthIndex + 1, 1),
  };
}

/** Whether a financial date falls in a month, by the same half-open rule. */
export function isInPeriodMonth(date: Date, month: PeriodMonth): boolean {
  const range = monthRange(month);
  return date.getTime() >= range.start.getTime() && date.getTime() < range.end.getTime();
}
