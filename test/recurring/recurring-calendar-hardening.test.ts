import { describe, expect, it } from 'vitest';

import {
  listOccurrenceDates,
  occurrenceDateAt,
  type RecurrenceSchedule,
} from '@/features/recurring/recurring-schedule';

/**
 * The M8E calendar regressions, pinned date by date.
 *
 * These are the cases a recurrence engine gets wrong quietly. A schedule that
 * drifts by a day does not throw; it just files rent in the wrong month for the
 * rest of the template's life, and the only symptom is a budget that looks
 * slightly off. So each sequence the milestone names is written out in full
 * rather than asserted as a property, and a regression has to name the date it
 * changed.
 *
 * The long-range tests use UTC millisecond arithmetic as an independent oracle.
 * UTC has no daylight saving, so it is a mechanism that shares no code with the
 * epoch-day arithmetic under test — if the two agree across a thousand days and
 * three year ends, they agree for the reason that matters.
 */

const monthly = (startDate: string, interval = 1): RecurrenceSchedule => ({
  startDate,
  frequency: 'monthly',
  interval,
  endDate: null,
});

const yearly = (startDate: string, interval = 1): RecurrenceSchedule => ({
  startDate,
  frequency: 'yearly',
  interval,
  endDate: null,
});

function firstDates(schedule: RecurrenceSchedule, count: number): string[] {
  return listOccurrenceDates(schedule, { limit: count }).dates;
}

/** The same calendar day, reached by a route that shares no code with the engine. */
function utcDayAfter(start: string, days: number): string {
  const [year, month, day] = start.split('-').map(Number);
  const instant = new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000);
  return instant.toISOString().slice(0, 10);
}

describe('daily recurrence over a long range', () => {
  it('matches plain UTC day arithmetic for a thousand consecutive days', () => {
    const schedule: RecurrenceSchedule = {
      startDate: '2026-01-01',
      frequency: 'daily',
      interval: 1,
      endDate: null,
    };

    // A thousand days crosses two ordinary year ends, a leap year and, in every
    // populated time zone, at least two daylight-saving changes.
    for (let index = 0; index < 1000; index += 1) {
      expect(occurrenceDateAt(schedule, index)).toBe(utcDayAfter('2026-01-01', index));
    }
  });

  it('steps every N days without accumulating error', () => {
    const schedule: RecurrenceSchedule = {
      startDate: '2027-02-25',
      frequency: 'daily',
      interval: 10,
      endDate: null,
    };

    for (let index = 0; index < 200; index += 1) {
      expect(occurrenceDateAt(schedule, index)).toBe(utcDayAfter('2027-02-25', index * 10));
    }
  });
});

describe('weekly recurrence', () => {
  it('keeps the starting weekday across months, a leap day and a year end', () => {
    const schedule: RecurrenceSchedule = {
      startDate: '2027-11-04',
      frequency: 'weekly',
      interval: 1,
      endDate: null,
    };
    const startWeekday = new Date(Date.UTC(2027, 10, 4)).getUTCDay();

    const dates = firstDates(schedule, 120);
    expect(dates).toHaveLength(120);
    for (const [index, date] of dates.entries()) {
      expect(date).toBe(utcDayAfter('2027-11-04', index * 7));
      const [year, month, day] = date.split('-').map(Number);
      expect(new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()).toBe(startWeekday);
    }
  });

  it('holds the weekday every third week too', () => {
    const schedule: RecurrenceSchedule = {
      startDate: '2028-02-29',
      frequency: 'weekly',
      interval: 3,
      endDate: null,
    };

    expect(firstDates(schedule, 6)).toEqual([
      '2028-02-29',
      '2028-03-21',
      '2028-04-11',
      '2028-05-02',
      '2028-05-23',
      '2028-06-13',
    ]);
  });
});

describe('monthly recurrence anchored to each end-of-month day', () => {
  it('keeps the 28th as an ordinary day, with no end-of-month behaviour', () => {
    // The 28th exists in every month including February, so nothing should ever
    // clamp — least of all in February, where a naive "is this the last day of
    // the month" rule would drag the rest of the year onto month ends.
    expect(firstDates(monthly('2026-01-28'), 14)).toEqual([
      '2026-01-28',
      '2026-02-28',
      '2026-03-28',
      '2026-04-28',
      '2026-05-28',
      '2026-06-28',
      '2026-07-28',
      '2026-08-28',
      '2026-09-28',
      '2026-10-28',
      '2026-11-28',
      '2026-12-28',
      '2027-01-28',
      '2027-02-28',
    ]);
  });

  it('recovers the 29th after a short February and keeps it in a leap year', () => {
    expect(firstDates(monthly('2027-01-29'), 15)).toEqual([
      '2027-01-29',
      '2027-02-28', // 2027 is a common year: clamped.
      '2027-03-29', // and immediately back to the anchor.
      '2027-04-29',
      '2027-05-29',
      '2027-06-29',
      '2027-07-29',
      '2027-08-29',
      '2027-09-29',
      '2027-10-29',
      '2027-11-29',
      '2027-12-29',
      '2028-01-29',
      '2028-02-29', // 2028 is a leap year: the 29th exists, so no clamping.
      '2028-03-29',
    ]);
  });

  it('keeps the 30th and never settles on February’s last day', () => {
    expect(firstDates(monthly('2026-01-30'), 16)).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
      '2026-05-30',
      '2026-06-30',
      '2026-07-30',
      '2026-08-30',
      '2026-09-30',
      '2026-10-30',
      '2026-11-30',
      '2026-12-30',
      '2027-01-30',
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
    ]);
  });

  it('keeps the 31st through every short month, in both leap and common years', () => {
    expect(firstDates(monthly('2028-01-31'), 14)).toEqual([
      '2028-01-31',
      '2028-02-29', // leap year: the 29th is February's last.
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
      '2028-07-31',
      '2028-08-31',
      '2028-09-30',
      '2028-10-31',
      '2028-11-30',
      '2028-12-31',
      '2029-01-31',
      '2029-02-28', // common year, and the anchor is still the 31st.
    ]);
  });

  it('holds the 31st anchor across four years of short months', () => {
    const dates = firstDates(monthly('2026-01-31'), 48);
    // Every January is the 31st: forty-eight months of clamping have moved nothing.
    expect(dates.filter((date) => date.endsWith('-01-31'))).toEqual([
      '2026-01-31',
      '2027-01-31',
      '2028-01-31',
      '2029-01-31',
    ]);
    expect(dates.filter((date) => date.startsWith('2028-02'))).toEqual(['2028-02-29']);
  });

  it('steps every other month from the 31st', () => {
    expect(firstDates(monthly('2026-01-31', 2), 7)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-09-30',
      '2026-11-30',
      '2027-01-31',
    ]);
  });
});

describe('yearly recurrence on February 29', () => {
  it('clamps to the 28th in common years and returns on the next leap day', () => {
    expect(firstDates(yearly('2028-02-29'), 5)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('survives the hundred-year rule, where 2100 is not a leap year', () => {
    expect(firstDates(yearly('2096-02-29', 4), 4)).toEqual([
      '2096-02-29',
      '2100-02-28', // divisible by 100 and not by 400: a common year.
      '2104-02-29',
      '2108-02-29',
    ]);
  });
});

describe('the turn of the year', () => {
  it('carries December 31 into January for every frequency', () => {
    expect(firstDates({ ...monthly('2026-12-31'), frequency: 'daily' }, 3)).toEqual([
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(firstDates({ ...monthly('2026-12-31'), frequency: 'weekly' }, 3)).toEqual([
      '2026-12-31',
      '2027-01-07',
      '2027-01-14',
    ]);
    expect(firstDates(monthly('2026-12-31'), 3)).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
    expect(firstDates(yearly('2026-12-31'), 3)).toEqual(['2026-12-31', '2027-12-31', '2028-12-31']);
  });

  it('crosses a leap-year boundary on the last day of February', () => {
    expect(firstDates({ ...monthly('2027-12-29'), frequency: 'monthly' }, 4)).toEqual([
      '2027-12-29',
      '2028-01-29',
      '2028-02-29',
      '2028-03-29',
    ]);
  });
});
