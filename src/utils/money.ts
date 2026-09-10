const moneyPattern = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Convert a decimal money string to integer minor units without floating point arithmetic. */
export function parseMoneyToMinorUnits(value: string): number | null {
  const match = moneyPattern.exec(value.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  const minorText = `${sign}${whole}${fraction.padEnd(2, '0')}`;
  const minor = Number(minorText);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Digit grouping is a property of the currency's home locale, not of the
 * device. NPR and INR group in the South Asian lakh form (`1,24,500`); USD in
 * thousands. Grouping is done by hand rather than through `Intl` so the result
 * is identical on Hermes, on web, and in Node tests.
 */
export type GroupingStyle = 'lakh' | 'thousand';

const lakhCurrencies: ReadonlySet<string> = new Set(['NPR', 'INR']);

export function groupingStyleFor(currency: string): GroupingStyle {
  return lakhCurrencies.has(currency.toUpperCase()) ? 'lakh' : 'thousand';
}

export function groupInteger(digits: string, style: GroupingStyle): string {
  if (digits.length <= 3) return digits;
  if (style === 'thousand') return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

/** The three parts an amount is rendered as. See `<Money>`. */
export type MoneyParts = {
  negative: boolean;
  code: string;
  /** Grouped integer part, no sign. */
  integer: string;
  /** Two digits, no separator. */
  decimals: string;
};

export function splitMinorUnits(minorUnits: number, currency: string): MoneyParts {
  const code = currency.toUpperCase();
  const absolute = Math.abs(minorUnits);
  return {
    negative: minorUnits < 0,
    code,
    integer: groupInteger(String(Math.floor(absolute / 100)), groupingStyleFor(code)),
    decimals: String(absolute % 100).padStart(2, '0'),
  };
}

/** Plain-string form for accessibility labels, logs and exports. */
export function formatMinorUnits(minorUnits: number, currency: string): string {
  const { negative, code, integer, decimals } = splitMinorUnits(minorUnits, currency);
  return `${negative ? '-' : ''}${code} ${integer}.${decimals}`;
}
