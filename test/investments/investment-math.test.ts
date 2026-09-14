import { describe, expect, it } from 'vitest';

import {
  averageUnitCost,
  divideRoundHalfUp,
  formatQuantity,
  parseQuantity,
  proportionalCost,
  QUANTITY_FACTOR,
  toSafeInteger,
  valueAtPrice,
} from '@/features/investments/investment-math';
import {
  compareTrades,
  replayTrades,
  type ReplayTrade,
} from '@/features/investments/investment-replay';
import { ValidationError } from '@/features/shared/errors';

/**
 * The arithmetic and the replay, with no database.
 *
 * Money is minor units: Rs. 1,000 is 100,000. Quantity is 10^-8 of a unit:
 * 10 shares is 1,000,000,000.
 */

const UNIT = 100_000_000;
const shares = (whole: number) => whole * UNIT;
const rupees = (whole: number) => whole * 100;
const day = (n: number) => new Date(2026, 8, n, 0, 0, 0).getTime();

let sequence = 0;
function trade(fields: Partial<ReplayTrade> & Pick<ReplayTrade, 'tradeType'>): ReplayTrade {
  sequence += 1;
  return {
    syncId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    tradeDate: day(1),
    createdAt: sequence,
    quantityMinor: null,
    unitPriceMinor: null,
    feeMinor: 0,
    amountMinor: null,
    ...fields,
  };
}

const buy = (quantity: number, price: number, fee = 0, date = day(1)) =>
  trade({
    tradeType: 'buy',
    quantityMinor: shares(quantity),
    unitPriceMinor: rupees(price),
    feeMinor: rupees(fee),
    tradeDate: date,
  });
const sell = (quantity: number, price: number, fee = 0, date = day(2)) =>
  trade({
    tradeType: 'sell',
    quantityMinor: shares(quantity),
    unitPriceMinor: rupees(price),
    feeMinor: rupees(fee),
    tradeDate: date,
  });

describe('quantity', () => {
  it('is stored to eight decimal places, exactly', () => {
    expect(QUANTITY_FACTOR).toBe(BigInt(UNIT));
    expect(parseQuantity('1.23456789')).toBe(123_456_789);
    expect(parseQuantity('10')).toBe(shares(10));
    expect(parseQuantity(' 0.00000001 ')).toBe(1);
    expect(formatQuantity(123_456_789)).toBe('1.23456789');
    expect(formatQuantity(shares(6))).toBe('6');
    expect(formatQuantity(150_000_000)).toBe('1.5');
  });

  it('survives a round trip for every precision it supports', () => {
    for (const text of ['1', '1.2', '1.23', '1.234567', '1.23456789', '90071992.54740991']) {
      expect(formatQuantity(parseQuantity(text))).toBe(text);
    }
  });

  it('refuses anything that is not a plain positive decimal it can store exactly', () => {
    for (const text of ['0', '0.000000000', '-1', '1.234567891', '1e3', '1,000', '', 'abc']) {
      expect(() => parseQuantity(text), text).toThrow(ValidationError);
    }
    // One unit past the largest exact integer.
    expect(() => parseQuantity('90071992.54740992')).toThrow(ValidationError);
  });
});

describe('fixed-point arithmetic', () => {
  it('rounds exactly one half up, and nothing else', () => {
    expect(divideRoundHalfUp(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(divideRoundHalfUp(BigInt(4), BigInt(3))).toBe(BigInt(1));
    expect(divideRoundHalfUp(BigInt(5), BigInt(3))).toBe(BigInt(2));
    expect(divideRoundHalfUp(BigInt(0), BigInt(7))).toBe(BigInt(0));
  });

  it('values a quantity at a price in minor units', () => {
    expect(valueAtPrice(BigInt(shares(10)), BigInt(rupees(1_000)))).toBe(BigInt(rupees(10_000)));
    // 1.5 units at 3.33 is 4.995, which rounds half up to 5.00.
    expect(valueAtPrice(BigInt(150_000_000), BigInt(333))).toBe(BigInt(500));
  });

  it('keeps products far beyond 2^53 exact, and refuses to shrink them into a number', () => {
    const quantity = BigInt(Number.MAX_SAFE_INTEGER);
    const price = BigInt(Number.MAX_SAFE_INTEGER);
    const value = valueAtPrice(quantity, price);
    expect(value).toBe(
      (quantity * price * BigInt(2) + QUANTITY_FACTOR) / (QUANTITY_FACTOR * BigInt(2)),
    );
    expect(() => toSafeInteger(value, 'Market value')).toThrow(ValidationError);
    expect(toSafeInteger(BigInt(Number.MAX_SAFE_INTEGER), 'x')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('takes the whole cost basis when the whole holding goes', () => {
    expect(proportionalCost(BigInt(1_000_001), BigInt(7), BigInt(7))).toBe(BigInt(1_000_001));
    expect(proportionalCost(BigInt(1_010_000), BigInt(4), BigInt(10))).toBe(BigInt(404_000));
  });

  it('has no average cost for nothing held', () => {
    expect(averageUnitCost(BigInt(0), BigInt(0))).toBeNull();
    expect(averageUnitCost(BigInt(rupees(10_100)), BigInt(shares(10)))).toBe(BigInt(rupees(1_010)));
  });
});

describe('weighted average cost', () => {
  it('matches the milestone example exactly', () => {
    // Buy 10 at 1,000 with a fee of 100: cost 10,100, average 1,010.
    const bought = replayTrades([buy(10, 1_000, 100)]);
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.position.quantityMinor).toBe(BigInt(shares(10)));
    expect(bought.position.costBasisMinor).toBe(BigInt(rupees(10_100)));

    // Sell 4 at 1,200 with a fee of 50: net 4,750, basis sold 4,040, gain 710.
    const sold = replayTrades([buy(10, 1_000, 100), sell(4, 1_200, 50)]);
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    const { position } = sold;
    expect(position.quantityMinor).toBe(BigInt(shares(6)));
    expect(position.costBasisMinor).toBe(BigInt(rupees(6_060)));
    expect(position.realizedGainMinor).toBe(BigInt(rupees(710)));
    expect(position.investedMinor).toBe(BigInt(rupees(10_100)));
    expect(position.proceedsMinor).toBe(BigInt(rupees(4_750)));
    // The remaining units keep the same average cost.
    expect(averageUnitCost(position.costBasisMinor, position.quantityMinor)).toBe(
      BigInt(rupees(1_010)),
    );
    // And at 1,200 they are worth 7,200: an unrealized gain of 1,140.
    const value = valueAtPrice(position.quantityMinor, BigInt(rupees(1_200)));
    expect(value).toBe(BigInt(rupees(7_200)));
    expect(value - position.costBasisMinor).toBe(BigInt(rupees(1_140)));
  });

  it('adds each buy’s cost and fee to the basis', () => {
    const result = replayTrades([buy(10, 1_000, 100), buy(10, 1_300, 0, day(2))]);
    if (!result.ok) throw new Error('expected a valid history');
    expect(result.position.costBasisMinor).toBe(BigInt(rupees(23_100)));
    expect(averageUnitCost(result.position.costBasisMinor, result.position.quantityMinor)).toBe(
      BigInt(rupees(1_155)),
    );
  });

  it('closes a position with no stray basis, however the rounding fell', () => {
    // Three units for 10.00: every part-sale rounds, the last sale takes the rest.
    const result = replayTrades([
      trade({ tradeType: 'buy', quantityMinor: shares(3), unitPriceMinor: 333, feeMinor: 1 }),
      sell(1, 5, 0, day(2)),
      sell(1, 5, 0, day(3)),
      sell(1, 5, 0, day(4)),
    ]);
    if (!result.ok) throw new Error('expected a valid history');
    expect(result.position.quantityMinor).toBe(BigInt(0));
    expect(result.position.costBasisMinor).toBe(BigInt(0));
    // 15.00 of proceeds against 10.00 of cost.
    expect(result.position.realizedGainMinor).toBe(BigInt(500));
  });

  it('counts dividends and standalone fees apart from quantity, basis and trading gain', () => {
    const result = replayTrades([
      buy(10, 1_000, 100),
      trade({ tradeType: 'dividend', amountMinor: rupees(500), tradeDate: day(3) }),
      trade({ tradeType: 'fee', amountMinor: rupees(25), tradeDate: day(4) }),
    ]);
    if (!result.ok) throw new Error('expected a valid history');
    expect(result.position.quantityMinor).toBe(BigInt(shares(10)));
    expect(result.position.costBasisMinor).toBe(BigInt(rupees(10_100)));
    expect(result.position.realizedGainMinor).toBe(BigInt(0));
    expect(result.position.dividendsMinor).toBe(BigInt(rupees(500)));
    expect(result.position.otherFeesMinor).toBe(BigInt(rupees(25)));
  });

  it('records a loss as a negative gain', () => {
    const result = replayTrades([buy(10, 1_000, 100), sell(10, 900, 50)]);
    if (!result.ok) throw new Error('expected a valid history');
    // 9,000 - 50 - 10,100.
    expect(result.position.realizedGainMinor).toBe(BigInt(rupees(-1_150)));
  });
});

describe('a history that sells more than it holds', () => {
  it('is refused, wherever the oversell sits', () => {
    const first = buy(10, 1_000, 0, day(1));
    const later = sell(7, 1_100, 0, day(5));
    const backdated = sell(7, 1_100, 0, day(3));
    const result = replayTrades([first, later, backdated]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The backdated sale is first in time, so it is the later one that fails.
    expect(result.violation.syncId).toBe(later.syncId);
    expect(result.violation.heldQuantityMinor).toBe(BigInt(shares(3)));
    expect(result.violation.soldQuantityMinor).toBe(BigInt(shares(7)));
  });

  it('becomes valid when a backdated buy covers the sale', () => {
    const sale = sell(5, 1_000, 0, day(5));
    expect(replayTrades([sale]).ok).toBe(false);
    expect(replayTrades([sale, buy(5, 900, 0, day(1))]).ok).toBe(true);
  });

  it('never shorts: selling from nothing is refused', () => {
    expect(replayTrades([sell(0.00000001, 1)]).ok).toBe(false);
  });
});

describe('replay order', () => {
  it('is date, then entry order, then identity — whatever order the rows arrive in', () => {
    const a = trade({
      tradeType: 'buy',
      quantityMinor: 1,
      unitPriceMinor: 1,
      tradeDate: day(2),
      createdAt: 1,
    });
    const b = trade({
      tradeType: 'buy',
      quantityMinor: 1,
      unitPriceMinor: 1,
      tradeDate: day(1),
      createdAt: 5,
    });
    const c = trade({
      tradeType: 'buy',
      quantityMinor: 1,
      unitPriceMinor: 1,
      tradeDate: day(2),
      createdAt: 1,
      syncId: 'ffffffff-0000-4000-8000-000000000000',
    });
    const d = trade({
      tradeType: 'buy',
      quantityMinor: 1,
      unitPriceMinor: 1,
      tradeDate: day(2),
      createdAt: 0,
    });
    expect([a, b, c, d].sort(compareTrades)).toEqual([b, d, a, c]);
    expect([c, d, a, b].sort(compareTrades)).toEqual([b, d, a, c]);
  });

  it('replays same-day trades in the order they were entered', () => {
    const sameDay = day(4);
    const bought = trade({
      tradeType: 'buy',
      quantityMinor: shares(5),
      unitPriceMinor: 100,
      tradeDate: sameDay,
      createdAt: 10,
    });
    const soldAfter = trade({
      tradeType: 'sell',
      quantityMinor: shares(5),
      unitPriceMinor: 100,
      tradeDate: sameDay,
      createdAt: 11,
    });
    const soldBefore = trade({
      tradeType: 'sell',
      quantityMinor: shares(5),
      unitPriceMinor: 100,
      tradeDate: sameDay,
      createdAt: 9,
    });
    expect(replayTrades([soldAfter, bought]).ok).toBe(true);
    expect(replayTrades([bought, soldBefore]).ok).toBe(false);
  });
});
