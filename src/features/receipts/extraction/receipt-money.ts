import { parseMoneyToMinorUnits } from '@/utils/money';

import type { ReceiptConfidence } from '../receipt.types';

/**
 * Reading an amount off a receipt, conservatively.
 *
 * `1.234` is 1,234 in Kathmandu and 1.234 in Berlin, and a photograph does not
 * say which. A parser that picks one and moves on is wrong roughly half the
 * time it meets that string, silently, in a number that becomes someone's
 * expense. So the rule here is: decide only when the string itself settles it,
 * and when it does not, say so and let a person choose.
 *
 * Everything is integer minor units, produced by `parseMoneyToMinorUnits` from
 * a canonical `123.45` string that this module builds by hand. No `parseFloat`
 * touches money at any point.
 */

export type MoneyReading = {
  amountMinor: number;
  confidence: ReceiptConfidence;
  basis: string;
};

/** A money-shaped token and where it sat on the line. */
export type MoneyToken = {
  raw: string;
  reading: MoneyReading | null;
  /** Offset in the scanned line, so the parser can tell left from right. */
  start: number;
};

/** Two decimal places, like every currency this app supports. */
const MINOR_DIGITS = 2;

/**
 * A digit run this long with no separator and no decimal part is a phone
 * number, an invoice number or a loyalty ID far more often than it is money.
 * The reading is still produced, flagged, and left for the selector to refuse
 * unless a total label vouches for it.
 */
const SUSPICIOUS_BARE_DIGITS = 7;

/** Thousands grouping: `1,234`, `12,345,678`. */
const thousandGroups = (sep: string) => new RegExp(`^\\d{1,3}(?:${sep}\\d{3})+$`);
/** South Asian lakh grouping, which NPR and INR receipts use: `1,24,500`. */
const lakhGroups = (sep: string) => new RegExp(`^\\d{1,2}(?:${sep}\\d{2})+${sep}\\d{3}$`);

/**
 * Letters OCR substitutes for digits *inside an otherwise numeric token*.
 *
 * Safe only here, where the token is already known to be mostly digits and
 * surrounded by digits and separators. The same substitution across a whole
 * line would turn `COSTCO` into `C0STC0`.
 */
function repairDigits(token: string): { repaired: string; changed: boolean } {
  const repaired = token
    .replace(/[OoQD]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5');
  return { repaired, changed: repaired !== token };
}

/**
 * Money-shaped tokens on one line, left to right.
 *
 * Space-grouped amounts (`1 234.56`) are joined first, but only when a decimal
 * part proves the space was grouping. Without that proof `2 500` could as
 * easily be a quantity beside a price, and merging them would invent an amount
 * that is nowhere on the receipt.
 */
export function findMoneyTokens(lineText: string): MoneyToken[] {
  const scanned = lineText.replace(/(\d) (\d{3}[.,]\d{1,2})(?!\d)/g, '$1$2');

  const tokens: MoneyToken[] = [];
  const pattern = /[-−]?[\dOoQDlI|Ss][\dOoQDlI|Ss.,]*/g;
  for (let match = pattern.exec(scanned); match !== null; match = pattern.exec(scanned)) {
    const raw = match[0];
    // At least one unambiguous digit, or the "token" is a word like `SOLD`.
    if (!/\d/.test(raw)) continue;
    tokens.push({ raw, reading: readMoneyToken(raw), start: match.index });
  }
  return tokens;
}

/**
 * One token to minor units, or null when it is not money at all.
 *
 * The separator analysis, in order:
 *
 * - Both `,` and `.` present — the **last** one is the decimal separator and
 *   the other is grouping. `1,234.56` and `1.234,56` are both settled by this,
 *   and both are certain.
 * - One separator kind, more than once — grouping throughout. `1.234.567`
 *   cannot be a decimal, so it is 1,234,567.
 * - One separator, once, with **two** digits after it — a decimal. This is the
 *   overwhelmingly common receipt shape.
 * - One separator, once, with **three** digits after it — genuinely ambiguous.
 *   `1.234` is 1234 grouped, or 1.234 with three decimals. Read as grouped,
 *   marked low, and the selector will not promote it on its own.
 * - No separator — a whole amount.
 */
export function readMoneyToken(token: string): MoneyReading | null {
  const trimmed = token.trim();
  // A minus on a receipt is a refund line, a discount, or OCR noise on a dash.
  // None of those is an expense total, and inferring one from a stray glyph is
  // exactly the guess this milestone forbids.
  if (/^[-−]/.test(trimmed)) return null;

  // Space grouping (`1 234.56`) is only grouping when the whole token is that
  // shape. Collapsing spaces anywhere else would weld a quantity to a price.
  const despaced = /^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(trimmed)
    ? trimmed.replace(/ /g, '')
    : trimmed;

  const { repaired, changed } = repairDigits(despaced);
  const body = repaired.replace(/[.,]+$/, '');
  if (!/^\d[\d.,]*$/.test(body)) return null;

  const commas = (body.match(/,/g) ?? []).length;
  const dots = (body.match(/\./g) ?? []).length;
  const penalty: ReceiptConfidence | null = changed ? 'medium' : null;

  if (commas > 0 && dots > 0) {
    const decimalSep = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    const cut = body.lastIndexOf(decimalSep);
    const whole = body.slice(0, cut);
    const fraction = body.slice(cut + 1);
    if (!isGrouped(whole, groupSep) || !/^\d{1,2}$/.test(fraction)) return null;
    return build(whole.split(groupSep).join(''), fraction, penalty ?? 'high', 'mixed_separators');
  }

  const sep = commas > 0 ? ',' : dots > 0 ? '.' : null;
  if (sep === null) {
    if (!/^\d+$/.test(body)) return null;
    const basis = body.length >= SUSPICIOUS_BARE_DIGITS ? 'bare_long_digit_run' : 'whole_number';
    const confidence: ReceiptConfidence =
      basis === 'bare_long_digit_run' ? 'low' : (penalty ?? 'high');
    return build(body, '', confidence, basis);
  }

  const count = commas + dots;
  if (count > 1) {
    if (!isGrouped(body, sep)) return null;
    return build(body.split(sep).join(''), '', penalty ?? 'high', 'grouped_integer');
  }

  const cut = body.indexOf(sep);
  const whole = body.slice(0, cut);
  const fraction = body.slice(cut + 1);
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return null;

  if (fraction.length <= MINOR_DIGITS) {
    return build(whole, fraction, penalty ?? 'high', 'decimal_separator');
  }
  if (fraction.length === 3) {
    // Grouped is the likelier reading, but "likelier" is not "known".
    if (!isGrouped(body, sep)) return null;
    return build(whole + fraction, '', 'low', 'ambiguous_three_digit_group');
  }
  return null;
}

function isGrouped(value: string, sep: string): boolean {
  if (!value.includes(sep)) return /^\d{1,3}$/.test(value) || /^\d+$/.test(value);
  const escaped = sep === '.' ? '\\.' : sep;
  return thousandGroups(escaped).test(value) || lakhGroups(escaped).test(value);
}

/**
 * The only place a number becomes money. Builds the canonical decimal string
 * and hands it to the app's own parser, so receipt amounts and typed amounts
 * go through identical arithmetic and identical safe-integer limits.
 */
function build(
  whole: string,
  fraction: string,
  confidence: ReceiptConfidence,
  basis: string,
): MoneyReading | null {
  const canonical =
    fraction.length === 0 ? whole : `${whole}.${fraction.padEnd(MINOR_DIGITS, '0')}`;
  const amountMinor = parseMoneyToMinorUnits(canonical);
  // Null here means it overflowed the safe integer range, which is a refusal
  // rather than a rounding opportunity.
  if (amountMinor === null || amountMinor <= 0) return null;
  return { amountMinor, confidence, basis };
}
