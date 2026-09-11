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

/**
 * The whole months a date range covers, or `null` when it does not cover whole
 * months.
 *
 * This is what keeps a monthly budget monthly. A report over "this week", or
 * over the 5th to the 22nd, covers part of a month, and a budget has no defined
 * reading against part of a month — dividing September's 30,000 by the days in
 * a week would invent a figure the user never set. So a range that does not
 * begin at the first instant of a month and end at the first instant of another
 * gets no budget comparison at all, rather than a prorated one.
 */
export function periodMonthsInRange(range: MonthRange): PeriodMonth[] | null {
  if (!isMonthBoundary(range.start) || !isMonthBoundary(range.end)) return null;
  if (range.end.getTime() <= range.start.getTime()) return null;

  const months: PeriodMonth[] = [];
  for (
    let cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    cursor.getTime() < range.end.getTime();
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    months.push(formatPeriodMonth(cursor));
  }
  return months;
}

/** Midnight on the first of a month, in local time. */
function isMonthBoundary(date: Date): boolean {
  return (
    date.getDate() === 1 &&
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

/** Whether a financial date falls in a month, by the same half-open rule. */
export function isInPeriodMonth(date: Date, month: PeriodMonth): boolean {
  const range = monthRange(month);
  return date.getTime() >= range.start.getTime() && date.getTime() < range.end.getTime();
}
