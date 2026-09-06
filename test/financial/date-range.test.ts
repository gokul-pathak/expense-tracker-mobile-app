import { describe, expect, it } from 'vitest';

import {
  getCurrentWeekRange,
  getLastNMonthsRange,
  getMonthRange,
  getPreviousMonthRange,
} from '@/utils/date-range';

describe('calendar report ranges', () => {
  it('uses inclusive starts and exclusive ends across a month boundary', () => {
    const range = getMonthRange(2024, 1);
    expect(range.start).toEqual(new Date(2024, 1, 1));
    expect(range.end).toEqual(new Date(2024, 2, 1));
  });

  it('handles leap-year February and December to January transitions', () => {
    expect(getMonthRange(2024, 1).end).toEqual(new Date(2024, 2, 1));
    expect(getPreviousMonthRange(new Date(2025, 0, 15))).toEqual({
      start: new Date(2024, 11, 1),
      end: new Date(2025, 0, 1),
    });
  });

  it('returns Monday-through-Monday week boundaries', () => {
    expect(getCurrentWeekRange(new Date(2024, 8, 8, 23, 0))).toEqual({
      start: new Date(2024, 8, 2),
      end: new Date(2024, 8, 9),
    });
  });

  it('includes the requested number of complete calendar months', () => {
    expect(getLastNMonthsRange(3, new Date(2024, 2, 31))).toEqual({
      start: new Date(2024, 0, 1),
      end: new Date(2024, 3, 1),
    });
  });
});
