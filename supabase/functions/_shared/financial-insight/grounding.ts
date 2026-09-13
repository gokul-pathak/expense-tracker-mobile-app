import { isPlainObject } from '../expense-suggestion/request-validation.ts';

/**
 * Whether an explanation's numbers all come from the context it explains.
 *
 * A model asked to explain "Expense NPR 42,500.00" can still write 40,000. It
 * is told to quote the context exactly and not to calculate, and this is how
 * that is checked rather than hoped for: every number written in the answer
 * must be one the context contains — an amount, a percentage, a count, or a
 * digit from a date or a label — and number words such as "million" or "lakh",
 * which the context never uses, are refused outright.
 *
 * A heuristic, and documented as one. It cannot tell a right number used in the
 * wrong sentence from a right number in the right one. It does stop invented
 * amounts, recomputed totals and figures lifted from injected text.
 */

const NUMBER_TOKEN = /(?<![\p{L}\p{N}.])[-+−]?\d[\d,]*(?:\.\d+)?%?/gu;
const NUMBER_WORDS =
  /\b(?:hundreds?|thousands?|lakhs?|lacs?|crores?|millions?|billions?|trillions?)\b/i;
/** Small counts and ordinals ("top 3", "2 budgets") are allowed without appearing in the context. */
const ALWAYS_ALLOWED = 10;

export function allowedNumbers(context: unknown): Set<string> {
  const allowed = new Set<string>();
  for (let value = 0; value <= ALWAYS_ALLOWED; value += 1) allowed.add(String(value));
  walk(context, allowed);
  return allowed;
}

/** The numbers and number words in these texts that the context does not contain. */
export function ungroundedNumbers(texts: readonly string[], allowed: Set<string>): string[] {
  const offenders: string[] = [];
  for (const text of texts) {
    const word = NUMBER_WORDS.exec(text);
    if (word !== null) offenders.push(word[0]);
    for (const token of text.match(NUMBER_TOKEN) ?? []) {
      if (!allowed.has(canonicalNumber(token))) offenders.push(token);
    }
  }
  return offenders;
}

/** `NPR 42,500.00` → `42500`, `18.40%` → `18.4`, `−09` → `9`. */
export function canonicalNumber(token: string): string {
  let text = token
    .replace(/^[-+−]/, '')
    .replace(/%$/, '')
    .replace(/,/g, '');
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  const [whole = '0', fraction] = text.split('.');
  const trimmed = whole.replace(/^0+(?=\d)/, '');
  return fraction === undefined ? trimmed : `${trimmed}.${fraction}`;
}

function walk(value: unknown, allowed: Set<string>): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    const absolute = Math.abs(value);
    allowed.add(canonicalNumber(String(absolute)));
    allowed.add(String(Math.round(absolute)));
    return;
  }
  if (typeof value === 'string') {
    for (const token of value.match(NUMBER_TOKEN) ?? []) allowed.add(canonicalNumber(token));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, allowed);
    return;
  }
  if (!isPlainObject(value)) return;
  if (typeof value.minor === 'number' && typeof value.display === 'string') {
    const absolute = Math.abs(value.minor);
    const cents = String(absolute % 100).padStart(2, '0');
    allowed.add(canonicalNumber(`${Math.floor(absolute / 100)}.${cents}`));
    return;
  }
  for (const item of Object.values(value)) walk(item, allowed);
}
