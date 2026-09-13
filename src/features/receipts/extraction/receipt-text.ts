/**
 * Turning raw OCR text into something a parser can reason about, without
 * throwing away what it needs.
 *
 * The temptation is to flatten a receipt into one string and run regexes over
 * it. That loses the single most useful fact on the page: a receipt is a
 * two-column layout, and a number means whatever the words to its left say it
 * means. `TOTAL` and `1,017.00` are related because they share a line, and
 * `CHANGE` and `500.00` are related for the same reason. Flatten them and the
 * parser can only guess.
 *
 * So lines survive. What gets normalised is everything that does not carry
 * meaning: Unicode form, exotic spaces, repeated blanks, and the letter-shaped
 * digits OCR produces in *labels*.
 */

/** One receipt line, in reading order, with its original text kept. */
export type ReceiptLine = {
  index: number;
  /** Whitespace-collapsed, trimmed. Original casing and characters otherwise. */
  text: string;
  /** Upper-cased and OCR-corrected. For label matching only — never for values. */
  label: string;
};

export type NormalizedReceiptText = {
  lines: ReceiptLine[];
  /** All lines joined by newline. Convenience for whole-document scans. */
  text: string;
};

/**
 * Confusions a receipt printer and an OCR engine reliably produce in words.
 *
 * Applied **only** to the `label` projection of a line, which is used to decide
 * what a line is about. It is never applied to a value, a merchant name or a
 * date, because there the same substitution destroys data: a global `O` to `0`
 * turns `COSTCO` into `C0STC0`, and `I` to `1` turns a merchant into noise.
 * Narrow and one-directional is the whole point.
 */
const LABEL_CONFUSIONS: readonly (readonly [RegExp, string])[] = [
  [/0/g, 'O'],
  [/1/g, 'I'],
  [/5/g, 'S'],
  [/8/g, 'B'],
  [/\$/g, 'S'],
];

/**
 * Characters OCR emits for a plain space, plus the ones that break regexes.
 * ` ` is the common one; the narrow no-break space turns up in currency
 * formatting, and the zero-width characters come from PDF-ish sources.
 */
const ODD_SPACES = /[   -   　]/g;
const ZERO_WIDTH = /[​-‍﻿]/g;

export function normalizeReceiptText(raw: string): NormalizedReceiptText {
  const unified = raw
    // Compose accents so a merchant name compares as one string everywhere.
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(ODD_SPACES, ' ')
    .replace(/\r\n?/g, '\n');

  const lines: ReceiptLine[] = [];
  for (const candidate of unified.split('\n')) {
    const text = candidate.replace(/[ \t]+/g, ' ').trim();
    // Blank lines carry no label and no value, and keeping them would only make
    // "the line after the merchant" mean something different on every receipt.
    if (text.length === 0) continue;
    lines.push({ index: lines.length, text, label: toLabel(text) });
  }

  return { lines, text: lines.map((line) => line.text).join('\n') };
}

/**
 * The label projection: upper case, OCR letter-confusions undone, punctuation
 * reduced to spaces so `SUB-TOTAL`, `SUB_TOTAL` and `SUB TOTAL` all match one
 * pattern.
 */
export function toLabel(text: string): string {
  let label = text.toUpperCase();
  for (const [pattern, replacement] of LABEL_CONFUSIONS) {
    label = label.replace(pattern, replacement);
  }
  return label
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * Whether a label contains one of a set of phrases as whole words.
 *
 * Word-boundary matching rather than `includes`, so `SUBTOTAL` does not count
 * as `TOTAL` — the distinction the entire amount strategy depends on. Phrases
 * are given already label-normalised (upper case, letters and spaces only).
 */
export function labelHas(label: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    const pattern = new RegExp(`(?:^| )${phrase.replace(/ /g, ' +')}(?:$| )`);
    if (pattern.test(label)) return true;
  }
  return false;
}
