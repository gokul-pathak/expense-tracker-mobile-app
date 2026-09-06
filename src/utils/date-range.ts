export type DateRange = {
  start: Date;
  end: Date;
};

/** Returns local calendar-month boundaries with an inclusive start and exclusive end. */
export function getCurrentMonthRange(now = new Date()): DateRange {
  return getMonthRange(now.getFullYear(), now.getMonth());
}

export function getMonthRange(year: number, month: number): DateRange {
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
  };
}

/** Monday through Sunday, using local calendar boundaries. */
export function getCurrentWeekRange(now = new Date()): DateRange {
  const start = startOfLocalDay(now);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return { start, end: addLocalDays(start, 7) };
}

export function getPreviousMonthRange(now = new Date()): DateRange {
  return getMonthRange(now.getFullYear(), now.getMonth() - 1);
}

/** Returns N calendar months ending with the current calendar month. */
export function getLastNMonthsRange(n: number, now = new Date()): DateRange {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('Month count must be positive.');
  return {
    start: new Date(now.getFullYear(), now.getMonth() - n + 1, 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function getCurrentYearRange(now = new Date()): DateRange {
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear() + 1, 0, 1),
  };
}

export function getCustomRange(start: Date, end: Date): DateRange {
  if (!(start instanceof Date) || Number.isNaN(start.getTime()))
    throw new RangeError('Start date is invalid.');
  if (!(end instanceof Date) || Number.isNaN(end.getTime()))
    throw new RangeError('End date is invalid.');
  if (end <= start) throw new RangeError('End date must be after start date.');
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
