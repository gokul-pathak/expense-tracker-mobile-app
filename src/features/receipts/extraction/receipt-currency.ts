import type { CurrencyField } from '../receipt.types';

import type { NormalizedReceiptText } from './receipt-text';

/**
 * Which currency the amount is in — and, more importantly, how we know.
 *
 * A receipt from Kathmandu and a receipt from Mumbai both print `Rs`, and both
 * print `₹`. The symbol narrows it to two currencies and settles neither. This
 * app has no exchange rates and never converts, so a wrong currency does not
 * produce a slightly wrong number — it files an expense that will never be
 * counted against the budget the user expects, because budgets match currency
 * exactly.
 *
 * That is why `source` exists alongside `value`. A code printed on the paper,
 * a guess from a symbol, and the app's own default standing in for silence are
 * three different claims, and a review screen has to be able to tell them
 * apart rather than showing all three as "NPR".
 */

/** Symbols, and every supported currency each one could mean. */
const SYMBOLS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\$/, ['USD']],
  [/₹/, ['INR', 'NPR']],
  [/(?:^|[^A-Z])RS\.?(?:[^A-Z]|$)/i, ['NPR', 'INR']],
  [/रू|रु/, ['NPR']],
  [/₨/, ['NPR', 'INR']],
];

export type CurrencyContext = {
  /** The app's setting. Used only as an explicitly-labelled fallback. */
  defaultCurrency: string | null;
  supportedCurrencies: readonly string[];
};

export function extractCurrency(
  normalized: NormalizedReceiptText,
  context: CurrencyContext,
): CurrencyField {
  const supported = context.supportedCurrencies.map((code) => code.toUpperCase());
  const upper = normalized.text.toUpperCase();

  // An explicit three-letter code is the only thing here that counts as read
  // from the receipt.
  const codes = supported.filter((code) =>
    new RegExp(`(?:^|[^A-Z])${code}(?:[^A-Z]|$)`).test(upper),
  );
  if (codes.length === 1) {
    return {
      value: codes[0]!,
      confidence: 'high',
      basis: 'explicit_currency_code',
      source: 'explicit_receipt',
    };
  }
  if (codes.length > 1) {
    // Two codes on one receipt: often a foreign-exchange note or a card
    // settlement line. Not something to resolve by picking the first.
    return {
      value: null,
      confidence: 'none',
      basis: 'multiple_currency_codes',
      source: 'unknown',
    };
  }

  for (const [pattern, meanings] of SYMBOLS) {
    if (!pattern.test(normalized.text)) continue;
    const possible = meanings.filter((code) => supported.includes(code));
    if (possible.length === 1) {
      // One supported currency uses this symbol, so the inference is sound —
      // but it is still an inference about a glyph, never better than low.
      return {
        value: possible[0]!,
        confidence: 'low',
        basis: 'currency_symbol',
        source: 'symbol_inference',
      };
    }
    // `Rs` with both NPR and INR supported says nothing useful. Fall through
    // to the default rather than flipping a coin between two countries.
    break;
  }

  const fallback = context.defaultCurrency?.toUpperCase() ?? null;
  if (fallback !== null && supported.includes(fallback)) {
    return {
      value: fallback,
      confidence: 'low',
      basis: 'default_currency_setting',
      source: 'default_currency_fallback',
    };
  }

  return { value: null, confidence: 'none', basis: 'no_currency_found', source: 'unknown' };
}
