import { localDateOf, parseLocalDate, toEpochDay } from '@/features/recurring/recurring-schedule';
import { getCustomRange, getReportRange } from '@/features/reports/reports.service';
import type { ReportPreset } from '@/features/reports/reports.types';
import {
  addLocalDays,
  getCurrentWeekRange,
  getCurrentYearRange,
  getMonthRange,
  startOfLocalDay,
  type DateRange,
} from '@/utils/date-range';

import type { PeriodFact, PeriodKind, ResolvedPeriod } from './financial-context.types';

/**
 * Periods for insights, built only from the date ranges Reports and Budgets
 * already use: local calendar days, inclusive start, exclusive end. There is no
 * second date implementation here — only names for the ranges.
 *
 * Labels are English and built by hand rather than with `Intl`, so the same
 * period reads identically on Hermes, on web and in Node tests, and in the text
 * an AI is asked to quote.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export type SelectablePreset = Exclude<ReportPreset, 'last_1_month' | 'custom'>;

/** The Reports periods, in the Reports order. Custom arrives from Reports with its dates. */
export const INSIGHT_PRESETS: readonly { value: SelectablePreset; label: string }[] = [
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: '3 Months' },
  { value: 'last_6_months', label: '6 Months' },
  { value: 'this_year', label: 'This Year' },
];

const PRESET_KIND: Record<Exclude<ReportPreset, 'custom'>, PeriodKind> = {
  this_week: 'this_week',
  this_month: 'this_month',
  last_1_month: 'this_month',
  last_month: 'last_month',
  last_3_months: 'last_3_months',
  last_6_months: 'last_6_months',
  this_year: 'this_year',
};

/** A Reports preset, with the same range Reports would show for it. */
export function resolvePresetPeriod(
  preset: ReportPreset,
  now = new Date(),
  custom?: DateRange,
): ResolvedPeriod {
  if (preset === 'custom') {
    if (custom === undefined) return resolvePresetPeriod('this_month', now);
    return period('custom', getCustomRange(custom.start, custom.end));
  }
  return period(PRESET_KIND[preset], getReportRange(preset, now));
}

export function monthPeriod(year: number, monthIndex: number): ResolvedPeriod {
  return period('month', getMonthRange(year, monthIndex));
}

export function lastWeekPeriod(now = new Date()): ResolvedPeriod {
  const week = getCurrentWeekRange(now);
  return period('last_week', { start: addLocalDays(week.start, -7), end: week.start });
}

export function lastYearPeriod(now = new Date()): ResolvedPeriod {
  return period('last_year', getCurrentYearRange(new Date(now.getFullYear() - 1, 0, 1)));
}

export function todayPeriod(now = new Date()): ResolvedPeriod {
  const start = startOfLocalDay(now);
  return period('today', { start, end: addLocalDays(start, 1) });
}

export function yesterdayPeriod(now = new Date()): ResolvedPeriod {
  const today = startOfLocalDay(now);
  return period('custom', { start: addLocalDays(today, -1), end: today });
}

/**
 * The period a comparison looks back to: the calendar month before a month,
 * the week before a week, the year before a year, and for anything else the
 * same number of days immediately before.
 */
export function previousComparablePeriod(current: ResolvedPeriod): ResolvedPeriod {
  const { start } = current.range;
  switch (current.kind) {
    case 'this_month':
    case 'last_month':
    case 'month':
      return monthPeriod(start.getFullYear(), start.getMonth() - 1);
    case 'this_week':
    case 'last_week':
      return period(current.kind === 'this_week' ? 'last_week' : 'custom', {
        start: addLocalDays(start, -7),
        end: start,
      });
    case 'last_3_months':
    case 'last_6_months': {
      const months = current.kind === 'last_3_months' ? 3 : 6;
      return period('custom', {
        start: new Date(start.getFullYear(), start.getMonth() - months, 1),
        end: start,
      });
    }
    case 'this_year':
    case 'last_year':
      return period(
        current.kind === 'this_year' ? 'last_year' : 'custom',
        getCurrentYearRange(new Date(start.getFullYear() - 1, 0, 1)),
      );
    case 'today':
    case 'custom': {
      const days = Math.max(1, dayNumber(lastDay(current.range)) - dayNumber(start) + 1);
      return period('custom', { start: addLocalDays(start, -days), end: start });
    }
  }
}

/** Whether the period has started and not yet finished. */
export function isInProgress(current: ResolvedPeriod, now = new Date()): boolean {
  return current.range.start <= now && now < current.range.end;
}

export function periodFact(current: ResolvedPeriod): PeriodFact {
  return {
    kind: current.kind,
    label: current.label,
    start: localDateOf(current.range.start),
    end: localDateOf(lastDay(current.range)),
  };
}

/** `2026-09` → `September 2026`. */
export function periodMonthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  return monthLabel(year ?? 1970, (month ?? 1) - 1);
}

export function monthLabel(year: number, monthIndex: number): string {
  const date = new Date(year, monthIndex, 1);
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthIndexOf(name: string): number | null {
  const index = MONTHS.findIndex((month) => month.toLowerCase() === name.toLowerCase());
  return index === -1 ? null : index;
}

function period(kind: PeriodKind, range: DateRange): ResolvedPeriod {
  return { kind, range, label: labelFor(kind, range) };
}

function labelFor(kind: PeriodKind, range: DateRange): string {
  const { start } = range;
  const last = lastDay(range);
  switch (kind) {
    case 'today':
      return `Today (${dayLabel(start)})`;
    case 'this_week':
      return `This week (${dayLabel(start)} – ${dayLabel(last)})`;
    case 'last_week':
      return `Last week (${dayLabel(start)} – ${dayLabel(last)})`;
    case 'this_month':
      return `${monthLabel(start.getFullYear(), start.getMonth())} (this month)`;
    case 'last_month':
    case 'month':
      return monthLabel(start.getFullYear(), start.getMonth());
    case 'this_year':
      return `${start.getFullYear()} (this year)`;
    case 'last_year':
      return String(start.getFullYear());
    case 'last_3_months':
    case 'last_6_months':
    case 'custom':
      return coversWholeMonths(range)
        ? `${monthLabel(start.getFullYear(), start.getMonth())} – ${monthLabel(last.getFullYear(), last.getMonth())}`
        : `${dayLabel(start)} – ${dayLabel(last)}`;
  }
}

function coversWholeMonths(range: DateRange): boolean {
  const { start, end } = range;
  const atMidnight = (date: Date) =>
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  return start.getDate() === 1 && end.getDate() === 1 && atMidnight(start) && atMidnight(end);
}

function dayLabel(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The last calendar day inside an exclusive-end range. */
function lastDay(range: DateRange): Date {
  return startOfLocalDay(new Date(range.end.getTime() - 1));
}

function dayNumber(date: Date): number {
  return toEpochDay(parseLocalDate(localDateOf(date)));
}
