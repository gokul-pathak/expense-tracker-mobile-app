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
