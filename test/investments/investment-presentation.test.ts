import { describe, expect, it } from 'vitest';

import { INVESTMENT_ASSET_TYPES } from '@/db/constants';
import {
  InvestmentHistoryError,
  InvestmentValidationError,
} from '@/features/investments/investment.errors';
import { parseQuantity } from '@/features/investments/investment-math';
import * as present from '@/features/investments/investment-presentation';
import type {
  AssetHolding,
  CurrencyPortfolioSummary,
  TradeHistoryEntry,
} from '@/features/investments/investment.types';
import { NotFoundError, ValidationError } from '@/features/shared/errors';
import {
  getTransactionDirection,
  getTransactionLabel,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';

/**
 * The words, signs and orderings the investment screens put on screen and in a
 * screen reader's ear. Every figure here is handed in already computed, as the
 * services hand it to a screen; these tests pin how it is said.
 */

const rupees = (amount: number) => Math.round(amount * 100);
const units = (text: string) => parseQuantity(text);

function holding(overrides: Partial<AssetHolding> = {}): AssetHolding {
  return {
    assetId: 1,
    name: 'ABC Shares',
    symbol: null,
    assetType: 'stock',
    currency: 'NPR',
    isArchived: false,
    status: 'priced',
    quantityMinor: units('6'),
    costBasisMinor: rupees(6_060),
    averageUnitCostMinor: rupees(1_010),
    realizedGainMinor: rupees(710),
    dividendsMinor: 0,
    otherFeesMinor: 0,
    tradeCount: 2,
    latestPrice: { priceMinor: rupees(1_200), priceDate: '2026-09-10' },
    marketValueMinor: rupees(7_200),
    unrealizedGainMinor: rupees(1_140),
    ...overrides,
  };
}

function summary(overrides: Partial<CurrencyPortfolioSummary> = {}): CurrencyPortfolioSummary {
  return {
    currency: 'NPR',
    assetCount: 1,
    openPositionCount: 1,
    pricedPositionCount: 1,
    unpricedPositionCount: 0,
    costBasisMinor: rupees(6_060),
    pricedCostBasisMinor: rupees(6_060),
    marketValueMinor: rupees(7_200),
    pricedMarketValueMinor: rupees(7_200),
    unrealizedGainMinor: rupees(1_140),
    pricedUnrealizedGainMinor: rupees(1_140),
    realizedGainMinor: rupees(710),
    dividendsMinor: 0,
    otherFeesMinor: 0,
    ...overrides,
  };
}

function buyEntry(): TradeHistoryEntry {
  return {
    id: 7,
    assetId: 1,
    accountId: 3,
    tradeType: 'buy',
    tradeDate: new Date(2026, 8, 1),
    quantityMinor: units('10'),
    unitPriceMinor: rupees(1_000),
    feeMinor: rupees(100),
    amountMinor: null,
    currency: 'NPR',
    note: null,
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    syncId: '11111111-1111-4111-8111-111111111111',
    deletedAt: null,
    cashEffect: { transactionType: 'investment', direction: 'out', amountMinor: rupees(10_100) },
    accountName: 'Bank',
  } as TradeHistoryEntry;
}

describe('quantities', () => {
  it('prints the stored integer exactly, with trailing zeros dropped', () => {
    expect(present.formatQuantityLabel(units('10'))).toBe('10');
    expect(present.formatQuantityLabel(units('1.25'))).toBe('1.25');
    expect(present.formatQuantityLabel(units('0.123456'))).toBe('0.123456');
    expect(present.formatQuantityLabel(units('0.00000001'))).toBe('0.00000001');
  });

  it('groups the whole part the way the asset’s money is grouped', () => {
    expect(present.formatQuantityLabel(units('1234567.5'), 'NPR')).toBe('12,34,567.5');
    expect(present.formatQuantityLabel(units('1234567.5'), 'USD')).toBe('1,234,567.5');
  });

  it('counts shares for stocks and ETFs and units for everything else', () => {
    expect(present.formatHoldingQuantity(units('1'), 'stock')).toBe('1 share');
    expect(present.formatHoldingQuantity(units('6'), 'etf')).toBe('6 shares');
    expect(present.formatHoldingQuantity(units('2.5'), 'mutual_fund')).toBe('2.5 units');
    expect(present.formatHoldingQuantity(units('1'), 'crypto')).toBe('1 unit');
  });

  it('turns a stored quantity back into text that parses to the same integer', () => {
    for (const text of ['6', '1.25', '0.12345678', '90000000']) {
      expect(parseQuantity(present.quantityInputText(parseQuantity(text)))).toBe(
        parseQuantity(text),
      );
    }
  });
});

describe('money in words and signs', () => {
  it('signs a gain with a plus and a loss with a true minus, never a hyphen', () => {
    expect(present.formatAmount(rupees(1_140), 'NPR', { signed: true })).toBe('+1,140.00');
    expect(present.formatAmount(-rupees(200), 'NPR', { signed: true })).toBe('−200.00');
    expect(present.formatAmount(rupees(124_500), 'NPR', { code: true })).toBe('NPR 1,24,500.00');
  });

  it('reads an amount aloud in the currency’s own word, unsigned', () => {
    expect(present.speakAmount(rupees(7_200), 'NPR')).toBe('7,200 rupees');
    expect(present.speakAmount(1_250, 'USD')).toBe('12.50 dollars');
    expect(present.speakAmount(-rupees(50), 'INR')).toBe('50 rupees');
  });

  it('says a gain or a loss in words, so it never rests on colour alone', () => {
    expect(present.presentGain(rupees(1_900), 'NPR', 'unrealized')).toEqual({
      label: 'Gain',
      tone: 'positive',
      value: '+1,900.00',
      accessibilityLabel: 'Unrealized gain, 1,900 rupees',
    });
    expect(present.presentGain(-rupees(50), 'NPR', 'realized')).toEqual({
      label: 'Loss',
      tone: 'negative',
      value: '−50.00',
      accessibilityLabel: 'Realized loss, 50 rupees',
    });
    expect(present.presentGain(0, 'NPR', 'unrealized').label).toBe('No gain or loss');
  });

  it('keeps realized and unrealized apart and never calls either "profit"', () => {
    const unrealized = present.presentGain(rupees(1), 'NPR', 'unrealized').accessibilityLabel;
    const realized = present.presentGain(rupees(1), 'NPR', 'realized').accessibilityLabel;
    expect(unrealized).toMatch(/^Unrealized/);
    expect(realized).toMatch(/^Realized/);
    expect(unrealized + realized).not.toMatch(/profit/i);
  });
});

describe('holding rows', () => {
  it('reads a priced holding exactly as the milestone specifies', () => {
    expect(present.holdingAccessibilityLabel(holding())).toBe(
      'ABC Shares, 6 shares held, current value 7,200 rupees, unrealized gain 1,140 rupees.',
    );
    expect(present.holdingDetailLine(holding())).toBe('6 shares · Avg 1,010.00 · Price 1,200.00');
  });

  it('says a value is unavailable, never zero, while no price exists', () => {
    const unpriced = holding({
      status: 'unpriced',
      latestPrice: null,
      marketValueMinor: null,
      unrealizedGainMinor: null,
    });
    expect(present.holdingAccessibilityLabel(unpriced)).toBe(
      'ABC Shares, 6 shares held, current value unavailable.',
    );
    expect(present.holdingDetailLine(unpriced)).toBe('6 shares · Avg 1,010.00');
    expect(present.holdingAccessibilityLabel(unpriced)).not.toMatch(/\b0 rupees/);
  });

  it('keeps a sold-out holding’s realized gain and says nothing is held', () => {
    const closed = holding({
      status: 'closed',
      quantityMinor: 0,
      averageUnitCostMinor: null,
      marketValueMinor: 0,
      unrealizedGainMinor: 0,
    });
    expect(present.holdingDetailLine(closed)).toBe('No current holdings');
    expect(present.holdingAccessibilityLabel(closed)).toBe(
      'ABC Shares, no current holdings, realized gain 710 rupees.',
    );
  });

  it('names a loss as a loss and an archived asset as archived', () => {
    const losing = holding({ unrealizedGainMinor: -rupees(200), isArchived: true, symbol: 'ABC' });
    expect(present.holdingAccessibilityLabel(losing)).toBe(
      'ABC Shares, ABC, 6 shares held, current value 7,200 rupees, unrealized loss 200 rupees, archived.',
    );
  });
});

describe('asset lists', () => {
  it('shows a just-added asset with the holdings, a sold-out one under Closed, and archived ones apart', () => {
    expect(present.segmentOf(holding({ status: 'closed', quantityMinor: 0, tradeCount: 0 }))).toBe(
      'holdings',
    );
    expect(present.segmentOf(holding({ status: 'closed', quantityMinor: 0, tradeCount: 3 }))).toBe(
      'closed',
    );
    expect(present.segmentOf(holding({ isArchived: true }))).toBe('archived');
    expect(present.segmentOf(holding({ status: 'unpriced' }))).toBe('holdings');
  });

  it('orders by current value, then puts everything without a value after it by name', () => {
    const input = [
      holding({ assetId: 1, name: 'zeta', status: 'unpriced', marketValueMinor: null }),
      holding({ assetId: 2, name: 'Small', marketValueMinor: rupees(100) }),
      holding({ assetId: 3, name: 'alpha', status: 'unpriced', marketValueMinor: null }),
      holding({ assetId: 4, name: 'Large', marketValueMinor: rupees(9_000) }),
      holding({ assetId: 5, name: 'Alpha', status: 'unpriced', marketValueMinor: null }),
    ];
    const before = input.map((item) => item.assetId);
    expect(present.sortHoldings(input).map((item) => item.assetId)).toEqual([4, 2, 3, 5, 1]);
    // The same order every time, and the list handed in is left alone.
    expect(present.sortHoldings([...input].reverse()).map((item) => item.assetId)).toEqual([
      4, 2, 3, 5, 1,
    ]);
    expect(input.map((item) => item.assetId)).toEqual(before);
  });

  it('offers exactly the asset types the domain stores', () => {
    expect([...present.ASSET_TYPE_ORDER].sort()).toEqual([...INVESTMENT_ASSET_TYPES].sort());
    expect(present.ASSET_TYPE_ORDER.map((type) => present.ASSET_TYPE_LABELS[type])).toEqual([
      'Stock',
      'ETF',
      'Mutual Fund',
      'Bond',
      'Crypto',
      'Fixed Deposit',
      'Other',
    ]);
  });
});

describe('portfolio summaries', () => {
  it('says why a total is missing and how much of it is known', () => {
    expect(present.describeValueAvailability(summary())).toBeNull();
    expect(
      present.describeValueAvailability(
        summary({ openPositionCount: 2, unpricedPositionCount: 1, marketValueMinor: null }),
      ),
    ).toBe(
      '1 holding has no current price, so the total value is unavailable. Priced holdings are worth NPR 7,200.00.',
    );
  });

  it('reads a currency’s portfolio aloud without adding another currency to it', () => {
    expect(present.portfolioAccessibilityLabel(summary())).toBe(
      'NPR Portfolio, current value 7,200 rupees, cost basis 6,060 rupees, unrealized gain 1,140 rupees, realized gain 710 rupees.',
    );
    expect(present.portfolioTitle('USD')).toBe('USD Portfolio');
  });
});

describe('dates', () => {
  it('says when a price was set, with the year only when it is not this one', () => {
    expect(present.priceUpdatedLabel('2026-09-13', new Date(2026, 8, 14))).toBe(
      'Price updated Sep 13',
    );
    expect(present.priceUpdatedLabel('2025-09-13', new Date(2026, 8, 14))).toBe(
      'Price updated Sep 13, 2025',
    );
  });

  it('turns a picked date into the calendar day a price is stored for, and back', () => {
    expect(present.localDateText(new Date(2026, 8, 3, 23, 59))).toBe('2026-09-03');
    expect(present.localDateText(present.dateOfLocalDate('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('trades', () => {
  it('describes a buy and the cash it took', () => {
    const entry = buyEntry();
    expect(present.tradeDetailLine(entry, 'stock')).toBe('10 shares at 1,000.00 · Fee 100.00');
    expect(present.tradeAccountLine(entry)).toBe('From Bank');
    expect(present.tradeCashDirection(entry)).toBe('expense');
    expect(present.tradeAccessibilityLabel(entry, 'stock')).toBe(
      'Buy, Sep 1, 2026, 10 shares at 1,000 rupees each, fee 100 rupees, 10,100 rupees paid from Bank.',
    );
  });

  it('warns before deleting that later holdings and gains may change', () => {
    expect(present.deleteTradeCopy({ tradeType: 'buy' }).message).toMatch(
      /^Deleting this buy may affect later holdings and gains/,
    );
    expect(present.deleteTradeCopy({ tradeType: 'sell' }).message).toMatch(
      /^Deleting this sale may affect later holdings and gains/,
    );
    expect(present.deleteTradeCopy({ tradeType: 'dividend' }).message).toMatch(
      /Investment Return income/,
    );
  });

  it('says a dividend adds cash and counts as Investment Return income, exactly as recorded', () => {
    expect(present.describeDividendEffect('Bank')).toEqual([
      'This will add cash to Bank.',
      'This will also appear as Investment Return income.',
    ]);
    expect(present.describeBuyEffect('Bank')).toMatch(/not an expense/);
    expect(present.describeSellEffect('Bank')).toMatch(/not income/);
    expect(present.PRICE_EFFECT_NOTE).toMatch(/No cash moves/);
  });
});

describe('form input', () => {
  it('reads a quantity exactly or says why not, and treats an empty field as not yet typed', () => {
    expect(present.readQuantityInput('')).toEqual({ ok: false, error: null });
    expect(present.readQuantityInput('6')).toEqual({ ok: true, value: units('6') });
    expect(present.readQuantityInput('1,000')).toMatchObject({ ok: false });
    expect(present.readQuantityInput('0.123456789')).toEqual({
      ok: false,
      error: 'Quantity supports at most 8 decimal places.',
    });
  });

  it('reads money in minor units, with an optional fee defaulting to nothing', () => {
    expect(present.readAmountInput('100')).toEqual({ ok: true, value: rupees(100) });
    expect(present.readAmountInput('')).toEqual({ ok: false, error: null });
    expect(present.readAmountInput('', { optional: true })).toEqual({ ok: true, value: 0 });
    expect(present.readAmountInput('0')).toMatchObject({ ok: false });
    expect(present.readAmountInput('12.345')).toMatchObject({ ok: false });
    expect(present.amountInputText(100_005)).toBe('1000.05');
  });

  it('refuses a sale larger than what is available before the service is asked', () => {
    expect(present.availableLabel(units('6'), 'stock', 'NPR')).toBe('Available: 6 shares');
    expect(present.sellQuantityError(units('7'), units('6'), 'stock', 'NPR')).toBe(
      'You can sell up to 6 shares on this date.',
    );
    expect(present.sellQuantityError(units('6'), units('6'), 'stock', 'NPR')).toBeNull();
    expect(present.sellQuantityError(units('1'), 0, 'stock', 'NPR')).toBe(
      'Nothing is available to sell on this date.',
    );
  });
});

describe('refusals', () => {
  it('never shows the invariant the domain broke, only what to change', () => {
    const broken = new InvestmentHistoryError('Held 3, selling 4.', BigInt(3), BigInt(4));
    expect(present.describeInvestmentError(broken, 'delete')).toBe(
      'This change would make later investment history invalid.',
    );
    expect(present.describeInvestmentError(broken, 'edit')).toBe(
      'This change would make later investment history invalid.',
    );
    expect(present.describeInvestmentError(broken, 'sell')).toBe(
      'This sale is more than is available on that date, including what later sales need.',
    );
  });

  it('explains an asset or account archived while the form was open', () => {
    expect(
      present.describeInvestmentError(
        new InvestmentValidationError('asset_archived', 'Choose an active asset.'),
        'buy',
      ),
    ).toBe('This investment is archived. Unarchive it to record new trades.');
    expect(
      present.describeInvestmentError(
        new InvestmentValidationError('account_archived', 'Choose an active account.'),
        'sell',
      ),
    ).toBe('That account has been archived. Choose an active account.');
  });

  it('passes a plain validation sentence through and hides anything unexpected', () => {
    expect(
      present.describeInvestmentError(new ValidationError('Asset name is required.'), 'asset'),
    ).toBe('Asset name is required.');
    expect(
      present.describeInvestmentError(
        new NotFoundError('Investment trade 9 was not found.'),
        'delete',
      ),
    ).toBe('This record is no longer available. It may have been changed on another device.');
    expect(present.describeInvestmentError(new Error('SQLITE_CONSTRAINT: raw'), 'buy')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('investment cash in the transaction list', () => {
  const view = (overrides: Partial<TransactionView>) =>
    ({ categoryName: null, ...overrides }) as TransactionView;

  it('calls a purchase an investment buy and a sale an investment sell, never expense or income', () => {
    expect(getTransactionLabel(view({ type: 'investment', title: 'Investment Purchase' }))).toBe(
      'Investment Buy',
    );
    expect(getTransactionLabel(view({ type: 'investment', title: 'Investment Fee' }))).toBe(
      'Investment Fee',
    );
    expect(getTransactionLabel(view({ type: 'investment_return', title: 'Investment Sale' }))).toBe(
      'Investment Sell',
    );
    expect(getTransactionDirection({ type: 'investment' })).toBe('neutral');
    expect(getTransactionDirection({ type: 'investment_return' })).toBe('neutral');
  });

  it('names a dividend by its Investment Return category, as income', () => {
    const dividend = view({ type: 'income', title: 'Dividend', categoryName: 'Investment Return' });
    expect(getTransactionLabel(dividend)).toBe('Investment Return');
    expect(getTransactionDirection(dividend)).toBe('income');
  });
});
