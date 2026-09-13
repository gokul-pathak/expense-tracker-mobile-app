/**
 * Whether an explanation's numbers all come from the context the app sent.
 *
 * The server checks this before answering. The app checks it again, against
 * the context it built itself, because the server is a remote party and the
 * model behind it read text people typed. Every number in the explanation must
 * be an amount, percentage, count or date digit the context contains; number
 * words such as "million" or "lakh", which the context never uses, are refused.
 *
 * A heuristic: it stops invented, recomputed and injected figures. It cannot
 * tell a right number from the wrong sentence, which is why the screen shows
 * the headline figures itself rather than relying on prose.
 */

const NUMBER_TOKEN = /(?<![\p{L}\p{N}.])[-+−]?\d[\d,]*(?:\.\d+)?%?/gu;
const NUMBER_WORDS =
  /\b(?:hundreds?|thousands?|lakhs?|lacs?|crores?|millions?|billions?|trillions?)\b/i;
const ALWAYS_ALLOWED = 10;

export function allowedNumbersOf(context: unknown): Set<string> {
  const allowed = new Set<string>();
  for (let value = 0; value <= ALWAYS_ALLOWED; value += 1) allowed.add(String(value));
  collect(context, allowed);
  return allowed;
}

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

function collect(value: unknown, allowed: Set<string>): void {
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
    for (const item of value) collect(item, allowed);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.minor === 'number' && typeof record.display === 'string') {
    const absolute = Math.abs(record.minor);
    const cents = String(absolute % 100).padStart(2, '0');
    allowed.add(canonicalNumber(`${Math.floor(absolute / 100)}.${cents}`));
    return;
  }
  for (const item of Object.values(record)) collect(item, allowed);
}
