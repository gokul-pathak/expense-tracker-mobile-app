import {
  daysInMonth,
  formatLocalDate,
  type LocalDate,
} from '@/features/recurring/recurring-schedule';

import { field, missing, type ExtractedField, type ReceiptConfidence } from '../receipt.types';

import { labelHas, type NormalizedReceiptText } from './receipt-text';

/**
 * Which day the money moved.
 *
 * `03/04/2026` is the fourth of March in London and the third of April in
 * Chicago, and a receipt photograph carries no locale. The app cannot ask the
 * paper, so when the digits alone do not settle it this returns nothing and
 * says why. A wrong date is quieter than a wrong amount but not harmless: it
 * files an expense in the wrong month, against the wrong budget, in the wrong
 * report.
 *
 * A receipt also prints several dates — the sale, the invoice, the card's
 * expiry, the date the paper was printed. Only the first two are what we want,
 * and a card expiry read as a purchase date would land an expense two years in
 * the future.
 */

const MONTHS: Record<string, number> = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

/** Lines whose date is deliberately not the purchase date. */
const NOT_A_PURCHASE_DATE = [
  'EXPIRY',
  'EXP',
  'EXPIRES',
  'VALID THRU',
  'VALID UNTIL',
  'DUE DATE',
  'BEST BEFORE',
];

/** Lines that say outright which date they carry. */
const PURCHASE_DATE_LABELS = [
  'DATE',
  'INVOICE DATE',
  'BILL DATE',
  'PURCHASE DATE',
  'TRANSACTION DATE',
  'TXN DATE',
  'SALE DATE',
];

const ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
/** `12 Sep 2026`, `12 September 2026`, `12-SEP-2026`. */
const DAY_MONTH_NAME = /\b(\d{1,2})[ \-.]*([A-Za-z]{3,9})\.?[ \-.,]*(\d{4})\b/g;
/** `Sep 12 2026`, `September 12, 2026`. */
const MONTH_NAME_DAY = /\b([A-Za-z]{3,9})\.?[ \-.,]*(\d{1,2})(?:st|nd|rd|th)?[ \-.,]+(\d{4})\b/g;
/** `12/09/2026`, `12.09.26`, `12-09-2026`. Commas excluded so money never matches. */
const NUMERIC = /\b(\d{1,2})([/.-])(\d{1,2})\2(\d{2,4})\b/g;

type DateMatch = {
  date: LocalDate | null;
  confidence: ReceiptConfidence;
  basis: string;
  lineIndex: number;
};

export type DateContext = {
  /** Today, on the device asking. Used only to notice implausible futures. */
  currentLocalDate: LocalDate;
};

/** Whether a line carries anything date-shaped, so the amount parser can skip it. */
export function lineLooksLikeDate(text: string): boolean {
  for (const pattern of [ISO, DAY_MONTH_NAME, MONTH_NAME_DAY, NUMERIC]) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

export function extractDate(
  normalized: NormalizedReceiptText,
  context: DateContext,
): ExtractedField<LocalDate> {
  const matches: DateMatch[] = [];

  for (const line of normalized.lines) {
    if (labelHas(line.label, NOT_A_PURCHASE_DATE)) continue;
    const labelled = labelHas(line.label, PURCHASE_DATE_LABELS);
    for (const match of matchesIn(line.text, line.index)) {
      // A line that names itself the date is the best evidence there is.
      matches.push(labelled ? { ...match, confidence: match.confidence } : match);
      if (labelled) matches[matches.length - 1]!.basis += '_labelled';
    }
  }

  const usable = matches.filter((match) => match.date !== null);
  if (usable.length === 0) {
    // An ambiguous date is not a missing one, and a reviewer needs to know the
    // difference: one means "the receipt did not say", the other means "it said
    // something that could mean two days".
    const ambiguous = matches.find((match) => match.basis === 'ambiguous_numeric_date');
    return missing(ambiguous === undefined ? 'no_date_found' : 'ambiguous_numeric_date');
  }

  const labelledFirst = usable.find((match) => match.basis.endsWith('_labelled'));
  const chosen = labelledFirst ?? usable[0]!;

  // A receipt dated after today is either OCR damage or a misread year. It is
  // not silently corrected to today — that would invent a date nobody printed.
  const future = chosen.date! > context.currentLocalDate;
  return field(
    chosen.date,
    future ? downgrade(chosen.confidence) : chosen.confidence,
    future ? `${chosen.basis}_future` : chosen.basis,
  );
}

function* matchesIn(text: string, lineIndex: number): Generator<DateMatch> {
  for (const m of all(ISO, text)) {
    yield build(num(m[1]), num(m[2]), num(m[3]), 'high', 'iso_date', lineIndex);
  }
  for (const m of all(DAY_MONTH_NAME, text)) {
    const month = MONTHS[m[2]!.toUpperCase()];
    if (month === undefined) continue;
    yield build(num(m[3]), month, num(m[1]), 'high', 'month_name', lineIndex);
  }
  for (const m of all(MONTH_NAME_DAY, text)) {
    const month = MONTHS[m[1]!.toUpperCase()];
    if (month === undefined) continue;
    yield build(num(m[3]), month, num(m[2]), 'high', 'month_name', lineIndex);
  }
  for (const m of all(NUMERIC, text)) {
    yield numeric(num(m[1]), num(m[3]), m[4]!, lineIndex);
  }
}

/**
 * Two numbers and a year, where only the numbers can say which is the day.
 *
 * Over 12, a component can only be a day. When both are 12 or under the string
 * is genuinely two different dates and this reports the ambiguity rather than
 * picking the locale the developer happens to live in.
 */
function numeric(first: number, second: number, yearText: string, lineIndex: number): DateMatch {
  const twoDigitYear = yearText.length === 2;
  const year = twoDigitYear ? 2000 + num(yearText) : num(yearText);
  const base: ReceiptConfidence = twoDigitYear ? 'low' : 'medium';

  if (first > 12 && second <= 12)
    return build(year, second, first, base, 'numeric_day_first', lineIndex);
  if (second > 12 && first <= 12)
    return build(year, first, second, base, 'numeric_month_first', lineIndex);
  if (first > 12 && second > 12) {
    return { date: null, confidence: 'none', basis: 'invalid_date', lineIndex };
  }
  return { date: null, confidence: 'none', basis: 'ambiguous_numeric_date', lineIndex };
}

/** Builds a date only if that day exists. February 31 is refused, never rolled forward. */
function build(
  year: number,
  month: number,
  day: number,
  confidence: ReceiptConfidence,
  basis: string,
  lineIndex: number,
): DateMatch {
  const valid =
    year >= 1900 &&
    year <= 2999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month);
  if (!valid) return { date: null, confidence: 'none', basis: 'invalid_date', lineIndex };
  return { date: formatLocalDate({ year, month, day }), confidence, basis, lineIndex };
}

function downgrade(confidence: ReceiptConfidence): ReceiptConfidence {
  return confidence === 'high' ? 'medium' : confidence === 'medium' ? 'low' : 'none';
}

function num(value: string | undefined): number {
  return Number(value);
}

function* all(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    yield match;
  }
}
