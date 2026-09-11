import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysInMonth,
  formatLocalDate,
  fromEpochDay,
  getNextOccurrenceDate,
  isLeapYear,
  isLocalDate,
  isScheduledDate,
  iterateOccurrenceDates,
  listOccurrenceDates,
  localDateOf,
  occurrenceDateAt,
  occurrenceIndexOf,
  parseLocalDate,
  toEpochDay,
  toTransactionInstant,
  type RecurrenceSchedule,
} from '@/features/recurring/recurring-schedule';

/**
 * The calendar engine, with no database and no clock.
 *
 * Every case the milestone names is pinned here — end-of-month clamping without
 * drift, leap years, weekly anchoring, inclusive end dates — because each is a
 * place a schedule silently produces the wrong date, and a wrong date is a rent
 * payment filed in the wrong month.
 */

function schedule(
  startDate: string,
  frequency: RecurrenceSchedule['frequency'],
  interval = 1,
  endDate: string | null = null,
): RecurrenceSchedule {
  return { startDate, frequency, interval, endDate };
}

function first(value: RecurrenceSchedule, count: number): string[] {
  return listOccurrenceDates(value, { limit: count }).dates;
}

/** Weekday from the epoch day alone: 1970-01-01 was a Thursday. 0 is Sunday. */
function weekday(date: string): number {
  return (((toEpochDay(parseLocalDate(date)) + 4) % 7) + 7) % 7;
}

describe('calendar dates', () => {
  it('accepts real days and refuses days that do not exist', () => {
    expect(isLocalDate('2026-09-15')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-04-31')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-9-1')).toBe(false);
    expect(isLocalDate('2026-09-15T00:00:00Z')).toBe(false);
    expect(isLocalDate(20260915)).toBe(false);
  });

  it('knows which years are leap years, including the century rule', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('counts days exactly, agreeing with the calendar for two centuries', () => {
    // Every day from 1900 to 2100, checked against an independent calendar.
    const start = Date.UTC(1900, 0, 1) / 86_400_000;
    const end = Date.UTC(2100, 11, 31) / 86_400_000;
    for (let day = start; day <= end; day += 1) {
      const reference = new Date(day * 86_400_000);
      const civil = fromEpochDay(day);
      expect(civil).toEqual({
        year: reference.getUTCFullYear(),
        month: reference.getUTCMonth() + 1,
        day: reference.getUTCDate(),
      });
      expect(toEpochDay(civil)).toBe(day);
    }
  });

  it('adds days as calendar days, straight through a daylight-saving change', () => {
    // 2026-03-08 and 2026-11-01 are the US transitions; nothing here has a clock.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('stamps a generated transaction at local noon on its day', () => {
    const instant = toTransactionInstant('2026-08-15');
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getMonth()).toBe(7);
    expect(instant.getDate()).toBe(15);
    expect(instant.getHours()).toBe(12);
    expect(localDateOf(instant)).toBe('2026-08-15');
  });

  it('formats with fixed widths, so dates compare correctly as text', () => {
    expect(formatLocalDate({ year: 2026, month: 9, day: 1 })).toBe('2026-09-01');
    expect('2026-09-01' < '2026-10-01').toBe(true);
    expect('2026-09-30' < '2026-10-01').toBe(true);
  });
});

describe('monthly schedules', () => {
  it('clamps to the end of a short month and returns to the anchor after it', () => {
    // The milestone's fixture: rent on the 31st.
    expect(first(schedule('2026-01-31', 'monthly'), 5)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('never lets February drag the schedule to the 28th', () => {
    const dates = first(schedule('2026-01-31', 'monthly'), 12);
    expect(dates).not.toContain('2026-03-28');
    expect(dates).not.toContain('2026-04-28');
    expect(dates.at(-1)).toBe('2026-12-31');
    // Every month has exactly one date, on its last day or the 31st.
    expect(dates.map((date) => date.slice(5, 7))).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
    ]);
  });

  it('lands on February 29 in a leap year', () => {
    expect(first(schedule('2028-01-31', 'monthly'), 3)).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
    expect(first(schedule('2028-01-30', 'monthly'), 2)).toEqual(['2028-01-30', '2028-02-29']);
  });

  it('keeps an ordinary day of the month exactly', () => {
    expect(first(schedule('2026-06-15', 'monthly'), 4)).toEqual([
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ]);
  });

  it('steps every N months across a year end', () => {
    expect(first(schedule('2026-01-15', 'monthly', 3), 5)).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
      '2027-01-15',
    ]);
    expect(first(schedule('2026-11-30', 'monthly', 3), 3)).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
    ]);
  });
});

describe('yearly schedules', () => {
  it('moves February 29 to the 28th in a common year and back in the next leap year', () => {
    expect(first(schedule('2028-02-29', 'yearly'), 5)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('steps every N years on the same day', () => {
    expect(first(schedule('2026-09-15', 'yearly', 2), 3)).toEqual([
      '2026-09-15',
      '2028-09-15',
      '2030-09-15',
    ]);
  });
});

describe('weekly and daily schedules', () => {
  it('stays on the start’s weekday every other week', () => {
    // The milestone's fixture: 2026-09-07 is a Monday.
    const dates = first(schedule('2026-09-07', 'weekly', 2), 6);
    expect(dates).toEqual([
      '2026-09-07',
      '2026-09-21',
      '2026-10-05',
      '2026-10-19',
      '2026-11-02',
      '2026-11-16',
    ]);
    expect(dates.every((date) => weekday(date) === 1)).toBe(true);
  });

  it('steps calendar days, not milliseconds, through daylight saving and leap days', () => {
    expect(first(schedule('2026-03-06', 'daily'), 4)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(first(schedule('2028-02-27', 'daily', 1), 4)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(first(schedule('2026-09-01', 'daily', 10), 3)).toEqual([
      '2026-09-01',
      '2026-09-11',
      '2026-09-21',
    ]);
  });
});

describe('which dates belong to a schedule', () => {
  const rent = schedule('2026-01-31', 'monthly');

  it('recognises a clamped date, and refuses the days either side of it', () => {
    expect(occurrenceIndexOf(rent, '2026-01-31')).toBe(0);
    expect(occurrenceIndexOf(rent, '2026-02-28')).toBe(1);
    expect(occurrenceIndexOf(rent, '2026-02-27')).toBeNull();
    expect(occurrenceIndexOf(rent, '2026-03-30')).toBeNull();
    expect(occurrenceIndexOf(rent, '2026-03-31')).toBe(2);
  });

  it('refuses a date before the start and a date on the wrong day', () => {
    const fifteenth = schedule('2026-06-15', 'monthly');
    expect(isScheduledDate(fifteenth, '2026-09-14')).toBe(false);
    expect(isScheduledDate(fifteenth, '2026-09-15')).toBe(true);
    expect(isScheduledDate(fifteenth, '2026-05-15')).toBe(false);
    expect(isScheduledDate(schedule('2026-09-07', 'weekly', 2), '2026-09-14')).toBe(false);
  });

  it('treats the end date as inclusive, and nothing after it exists', () => {
    const ending = schedule('2026-06-30', 'monthly', 1, '2026-09-30');
    expect(listOccurrenceDates(ending, { limit: 100 })).toEqual({
      dates: ['2026-06-30', '2026-07-30', '2026-08-30', '2026-09-30'],
      hasMore: false,
    });
    expect(isScheduledDate(ending, '2026-09-30')).toBe(true);
    expect(isScheduledDate(ending, '2026-10-30')).toBe(false);
    expect(occurrenceDateAt(ending, 4)).toBe('2026-10-30');
  });

  it('bounds a list and says when more exist', () => {
    expect(listOccurrenceDates(schedule('2026-01-01', 'daily'), { limit: 3 })).toEqual({
      dates: ['2026-01-01', '2026-01-02', '2026-01-03'],
      hasMore: true,
    });
  });

  it('lists a window without walking from the start', () => {
    const daily = schedule('2016-01-01', 'daily');
    expect(
      listOccurrenceDates(daily, { from: '2026-09-10', to: '2026-09-12', limit: 10 }).dates,
    ).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    const monthly = schedule('2026-01-31', 'monthly');
    expect(listOccurrenceDates(monthly, { from: '2026-02-01', limit: 2 }).dates).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('finds the next date after a given day, or nothing once the schedule ends', () => {
    const ending = schedule('2026-06-15', 'monthly', 1, '2026-08-15');
    expect(getNextOccurrenceDate(ending, '2026-06-15')).toBe('2026-07-15');
    expect(getNextOccurrenceDate(ending, '2026-06-20')).toBe('2026-07-15');
    expect(getNextOccurrenceDate(ending, '2026-08-15')).toBeNull();
  });

  it('ends a schedule rather than writing a five-digit year', () => {
    const late = schedule('9998-06-01', 'yearly');
    expect([...iterateOccurrenceDates(late)]).toEqual(['9998-06-01', '9999-06-01']);
  });
});
