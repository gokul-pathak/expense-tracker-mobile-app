import { LOCAL_DATE_PATTERN, type RecurringFrequency } from '@/db/constants';

/**
 * Recurring calendar arithmetic.
 *
 * Pure: no database, no clock, no time zone. Every function here takes calendar
 * dates and returns calendar dates, so the same schedule produces the same
 * dates on every device and in every test, whatever the device's time zone and
 * whatever day it happens to be.
 *
 * Dates are `YYYY-MM-DD` text. Arithmetic is done on whole days counted from
 * 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's
 * `days_from_civil` and `civil_from_days`), so adding a day is adding one — not
 * adding 86,400,000 milliseconds to an instant, which a daylight-saving change
 * would turn into 23 or 25 hours and, around midnight, into the wrong date.
 *
 * The rules, which the tests pin down case by case:
 *
 * - `startDate` is the first occurrence.
 * - Daily and weekly step a fixed number of days from the start. Weekly stays on
 *   the start's weekday because seven days is always seven days.
 * - Monthly and yearly are anchored to the start's day of the month. A month
 *   too short for it uses its last day, and the *next* month returns to the
 *   anchor: January 31 runs Jan 31, Feb 28, Mar 31, Apr 30. Every occurrence is
 *   computed from the start, never from the previous occurrence, which is what
 *   stops February from dragging the schedule to the 28th forever.
 * - A yearly February 29 lands on February 28 in a common year and returns to
 *   the 29th in the next leap year — the same clamping rule, not a special case.
 * - `endDate` is inclusive, and a date after it does not exist.
 */

export type LocalDate = string;

export type RecurrenceSchedule = {
  startDate: LocalDate;
  frequency: RecurringFrequency;
  interval: number;
  endDate: LocalDate | null;
};

/** A calendar day. `month` is 1-12. */
export type CivilDate = { year: number; month: number; day: number };

/**
 * Dates are written with four-digit years. A schedule simply ends rather than
 * producing a date that cannot be written down.
 */
const MAX_YEAR = 9999;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1]!;
}

/** A real calendar day in `YYYY-MM-DD` form. February 30 is well-formed and still refused. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) return false;
  const { year, month, day } = split(value);
  return year >= 1 && day <= daysInMonth(year, month);
}

export function parseLocalDate(value: LocalDate): CivilDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`"${value}" is not a calendar date in YYYY-MM-DD form.`);
  }
  return split(value);
}

export function formatLocalDate({ year, month, day }: CivilDate): LocalDate {
  return (
    String(year).padStart(4, '0') +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0')
  );
}

/**
 * Days since 1970-01-01. Exact integer arithmetic over the proleptic Gregorian
 * calendar, valid for every date this module can represent.
 */
export function toEpochDay({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse of `toEpochDay`. */
export function fromEpochDay(epochDay: number): CivilDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** Calendar addition. `addDays('2026-03-28', 2)` is March 30 in every time zone. */
export function addDays(date: LocalDate, days: number): LocalDate {
  return formatLocalDate(fromEpochDay(toEpochDay(parseLocalDate(date)) + days));
}

/**
 * Chronological comparison. Fixed-width `YYYY-MM-DD` text orders exactly as the
 * dates do, which is why the database can compare these columns as text too.
 */
export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The calendar date an instant falls on in this device's local time. */
export function localDateOf(instant: Date): LocalDate {
  return formatLocalDate({
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
  });
}

/**
 * The instant a generated transaction is stamped with: local noon on the
 * scheduled date.
 *
 * A transaction's date is an instant in this app, while a scheduled date is a
 * day. Noon is the instant furthest from both midnights, so it is the one least
 * likely to be read as a different calendar day — and therefore a different
 * month, report or budget — on a device in another time zone. Midnight would be
 * yesterday for anyone even an hour to the west.
 */
export function toTransactionInstant(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  const instant = new Date(2000, 0, 1, 12, 0, 0, 0);
  // `setFullYear` rather than the constructor, which maps years 0-99 onto 1900-1999.
  instant.setFullYear(year, month - 1, day);
  return instant;
}

/**
 * The `index`th scheduled date, counting the start as 0, ignoring the end date.
 * Null only when the date would need a five-digit year.
 */
export function occurrenceDateAt(schedule: RecurrenceSchedule, index: number): LocalDate | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const start = parseLocalDate(schedule.startDate);

  switch (schedule.frequency) {
    case 'daily':
      return byDays(start, index * schedule.interval);
    case 'weekly':
      return byDays(start, index * schedule.interval * 7);
    case 'monthly': {
      // Always from the start, so a short month never becomes the new anchor.
      const zeroBasedMonth = start.month - 1 + index * schedule.interval;
      const year = start.year + Math.floor(zeroBasedMonth / 12);
      const month = (zeroBasedMonth % 12) + 1;
      return clamped(year, month, start.day);
    }
    case 'yearly':
      return clamped(start.year + index * schedule.interval, start.month, start.day);
  }
}

/**
 * Which occurrence a date is, or null if the schedule never lands on it.
 *
 * Ignores the end date: this answers "is this one of the template's dates",
 * and a date past the end is a date that was scheduled and is no longer wanted.
 * `isScheduledDate` is the question with the end date applied.
 */
export function occurrenceIndexOf(schedule: RecurrenceSchedule, date: LocalDate): number | null {
  if (!isLocalDate(date) || date < schedule.startDate) return null;
  const start = parseLocalDate(schedule.startDate);
  const target = parseLocalDate(date);

  let index: number;
  switch (schedule.frequency) {
    case 'daily':
    case 'weekly': {
      const step = schedule.interval * (schedule.frequency === 'weekly' ? 7 : 1);
      const elapsed = toEpochDay(target) - toEpochDay(start);
      if (elapsed % step !== 0) return null;
      index = elapsed / step;
      break;
    }
    case 'monthly': {
      const months = (target.year - start.year) * 12 + (target.month - start.month);
      if (months % schedule.interval !== 0) return null;
      index = months / schedule.interval;
      break;
    }
    case 'yearly': {
      if (target.month !== start.month) return null;
      const years = target.year - start.year;
      if (years % schedule.interval !== 0) return null;
      index = years / schedule.interval;
      break;
    }
  }
  // The right month is not enough: a clamped month has exactly one scheduled
  // day in it, and a date either side of it is not an occurrence.
  return occurrenceDateAt(schedule, index) === date ? index : null;
}

/** Whether a date is one of the template's occurrences, end date included. */
export function isScheduledDate(schedule: RecurrenceSchedule, date: LocalDate): boolean {
  if (occurrenceIndexOf(schedule, date) === null) return false;
  return schedule.endDate === null || date <= schedule.endDate;
}

/**
 * Scheduled dates in chronological order, lazily.
 *
 * Unbounded when neither `to` nor the schedule's end date is set: a template
 * without an end repeats forever, and the caller decides how many it wants.
 * Nothing is ever materialised ahead of time.
 */
export function* iterateOccurrenceDates(
  schedule: RecurrenceSchedule,
  bounds: { from?: LocalDate; to?: LocalDate } = {},
): Generator<LocalDate, void, undefined> {
  const from =
    bounds.from !== undefined && bounds.from > schedule.startDate
      ? bounds.from
      : schedule.startDate;
  const upper = earliest(bounds.to ?? null, schedule.endDate);
  if (upper !== null && upper < from) return;

  for (let index = firstIndexOnOrAfter(schedule, from); ; index += 1) {
    const date = occurrenceDateAt(schedule, index);
    if (date === null) return;
    if (upper !== null && date > upper) return;
    yield date;
  }
}

/** A bounded list, with whether more dates exist beyond it. */
export function listOccurrenceDates(
  schedule: RecurrenceSchedule,
  options: { from?: LocalDate; to?: LocalDate; limit: number },
): { dates: LocalDate[]; hasMore: boolean } {
  const dates: LocalDate[] = [];
  for (const date of iterateOccurrenceDates(schedule, options)) {
    if (dates.length === options.limit) return { dates, hasMore: true };
    dates.push(date);
  }
  return { dates, hasMore: false };
}

/** The first scheduled date strictly after `after`, or null when the schedule has ended. */
export function getNextOccurrenceDate(
  schedule: RecurrenceSchedule,
  after: LocalDate,
): LocalDate | null {
  const next = iterateOccurrenceDates(schedule, { from: addDays(after, 1) }).next();
  return next.done === true ? null : next.value;
}

/**
 * The smallest index whose date is on or after `from`.
 *
 * Computed directly rather than by walking from the start, so asking about a
 * daily schedule ten years in costs the same as asking about tomorrow. The
 * estimate can land one step early when a clamped month or year falls before
 * `from`, which the final loop corrects; it runs at most twice.
 */
function firstIndexOnOrAfter(schedule: RecurrenceSchedule, from: LocalDate): number {
  if (from <= schedule.startDate) return 0;
  const start = parseLocalDate(schedule.startDate);
  const target = parseLocalDate(from);

  let index: number;
  switch (schedule.frequency) {
    case 'daily':
    case 'weekly': {
      const step = schedule.interval * (schedule.frequency === 'weekly' ? 7 : 1);
      index = Math.ceil((toEpochDay(target) - toEpochDay(start)) / step);
      break;
    }
    case 'monthly': {
      const months = (target.year - start.year) * 12 + (target.month - start.month);
      index = Math.max(0, Math.ceil(months / schedule.interval));
      break;
    }
    case 'yearly':
      index = Math.max(0, Math.ceil((target.year - start.year) / schedule.interval));
      break;
  }

  for (;;) {
    const date = occurrenceDateAt(schedule, index);
    if (date === null || date >= from) return index;
    index += 1;
  }
}

function byDays(start: CivilDate, days: number): LocalDate | null {
  if (!Number.isSafeInteger(days)) return null;
  const date = fromEpochDay(toEpochDay(start) + days);
  return date.year > MAX_YEAR ? null : formatLocalDate(date);
}

/** The anchor day, or the month's last day when the month is too short for it. */
function clamped(year: number, month: number, anchorDay: number): LocalDate | null {
  if (year > MAX_YEAR) return null;
  return formatLocalDate({ year, month, day: Math.min(anchorDay, daysInMonth(year, month)) });
}

function earliest(left: LocalDate | null, right: LocalDate | null): LocalDate | null {
  if (left === null) return right;
  if (right === null) return left;
  return left < right ? left : right;
}

function split(value: string): CivilDate {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}
