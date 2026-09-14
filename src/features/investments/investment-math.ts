import { INVESTMENT_QUANTITY_SCALE } from '@/db/constants';
import { ValidationError } from '@/features/shared/errors';

/**
 * Fixed-point arithmetic for investments.
 *
 * Two kinds of number meet here, and neither is ever a float. Money is integer
 * minor currency units, as everywhere else in the app. A quantity is integer
 * *quantity minor units*: `INVESTMENT_QUANTITY_SCALE` decimal places of one
 * whole unit, so 1.23456789 shares is stored as 123,456,789.
 *
 * The products are where precision is lost if it is going to be lost at all.
 * 90 million shares at a price of NPR 90 million each is a product near 10^31,
 * far past the 2^53 a JavaScript number holds exactly. So every product and
 * every division runs in BigInt, and a result is converted back to a number only
 * after it has been checked to fit — a figure that does not fit is refused, never
 * rounded into a plausible wrong one.
 *
 * Rounding happens in exactly two places, and both round a remainder of exactly
 * one half upwards: the value of a quantity at a price, and the share of a cost
 * basis that belongs to part of a holding. All inputs to both are non-negative.
 */

const ZERO = BigInt(0);
const TWO = BigInt(2);
const TEN = BigInt(10);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/** Quantity minor units in one whole unit: 10^8. */
export const QUANTITY_FACTOR = TEN ** BigInt(INVESTMENT_QUANTITY_SCALE);

/** Integer division of non-negative values, rounding exactly one half upwards. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) throw new RangeError('The denominator must be positive.');
  if (numerator < ZERO) throw new RangeError('The numerator must not be negative.');
  return (numerator * TWO + denominator) / (denominator * TWO);
}

/** What a quantity is worth at a price per whole unit, in minor currency units. */
export function valueAtPrice(quantityMinor: bigint, unitPriceMinor: bigint): bigint {
  return divideRoundHalfUp(quantityMinor * unitPriceMinor, QUANTITY_FACTOR);
}

/**
 * The part of a cost basis that belongs to `part` of `whole` units.
 *
 * Selling everything takes all of the cost, exactly, so a closed position never
 * keeps a stray minor unit of basis from rounding.
 */
export function proportionalCost(costMinor: bigint, part: bigint, whole: bigint): bigint {
  if (part === whole) return costMinor;
  return divideRoundHalfUp(costMinor * part, whole);
}

/** Cost per whole unit, for display. Never used to compute anything else. */
export function averageUnitCost(costMinor: bigint, quantityMinor: bigint): bigint | null {
  if (quantityMinor <= ZERO) return null;
  return divideRoundHalfUp(costMinor * QUANTITY_FACTOR, quantityMinor);
}

/** A BigInt as an exact JavaScript number, or a refusal naming what did not fit. */
export function toSafeInteger(value: bigint, label: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new ValidationError(`${label} is too large to record exactly.`);
  }
  return Number(value);
}

/**
 * `"1.5"` → 150,000,000.
 *
 * Plain decimal text only: no sign, no exponent, no grouping separators, and no
 * more places than the supported precision. `"1e3"` and `"1,000"` are refused
 * rather than guessed at, because a guessed quantity is a wrong holding.
 */
export function parseQuantity(text: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (match === null) throw new ValidationError('Quantity must be a positive decimal number.');
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > INVESTMENT_QUANTITY_SCALE) {
    throw new ValidationError(
      `Quantity supports at most ${INVESTMENT_QUANTITY_SCALE} decimal places.`,
    );
  }
  const minor =
    BigInt(whole) * QUANTITY_FACTOR + BigInt(fraction.padEnd(INVESTMENT_QUANTITY_SCALE, '0'));
  if (minor <= ZERO) throw new ValidationError('Quantity must be greater than zero.');
  return toSafeInteger(minor, 'Quantity');
}

/** 150,000,000 → `"1.5"`. Trailing zeros are dropped; a whole number has no point. */
export function formatQuantity(quantityMinor: number | bigint): string {
  const value = BigInt(quantityMinor);
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const whole = (absolute / QUANTITY_FACTOR).toString();
  const fraction = (absolute % QUANTITY_FACTOR)
    .toString()
    .padStart(INVESTMENT_QUANTITY_SCALE, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
