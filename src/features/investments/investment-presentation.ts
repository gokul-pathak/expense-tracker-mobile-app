import type { InvestmentAssetType, InvestmentTradeType } from '@/db/constants';
import { NotFoundError } from '@/features/shared/errors';
import { getUserErrorMessage } from '@/features/ui/error-message';
import {
  groupInteger,
  groupingStyleFor,
  parseMoneyToMinorUnits,
  splitMinorUnits,
} from '@/utils/money';

import { InvestmentHistoryError, InvestmentValidationError } from './investment.errors';
import { formatQuantity, parseQuantity, QUANTITY_FACTOR } from './investment-math';
import type {
  AssetHolding,
  CurrencyPortfolioSummary,
  PortfolioSummary,
  TradeHistoryEntry,
} from './investment.types';

/**
 * The words, signs and orderings the investment screens use.
 *
 * Every figure arrives already computed by the investment services: holdings,
 * gains, cash effects and previews. This module only decides how a figure is
 * said — which label, which sign, which order, what a screen reader hears. Nothing
 * in it adds, multiplies or rounds an amount, and no screen needs to either.
 */

const MINUS = '−';

// Types

export const ASSET_TYPE_LABELS: Record<InvestmentAssetType, string> = {
  stock: 'Stock',
  etf: 'ETF',
  mutual_fund: 'Mutual Fund',
  bond: 'Bond',
  crypto: 'Crypto',
  fixed_deposit: 'Fixed Deposit',
  other: 'Other',
};

/** The order Add Investment offers them in: exactly the stored types, none invented here. */
export const ASSET_TYPE_ORDER: readonly InvestmentAssetType[] = [
  'stock',
  'etf',
  'mutual_fund',
  'bond',
  'crypto',
  'fixed_deposit',
  'other',
];

export const TRADE_TYPE_LABELS: Record<InvestmentTradeType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  fee: 'Fee',
};

// Quantities

const SHARE_TYPES: ReadonlySet<InvestmentAssetType> = new Set(['stock', 'etf']);

/**
 * `600000000` → `6`, `125000000` → `1.25`, `12345600` → `0.123456`.
 *
 * Straight from the stored integer — never through a float — with trailing zeros
 * dropped and the whole part grouped the way the asset's money is grouped, so a
 * quantity and an amount on one row read alike.
 */
export function formatQuantityLabel(quantityMinor: number, currency?: string): string {
  const [whole = '0', fraction] = formatQuantity(quantityMinor).split('.');
  const grouped = groupInteger(whole, currency ? groupingStyleFor(currency) : 'thousand');
  return fraction ? grouped + '.' + fraction : grouped;
}

/** Shares for stocks and ETFs, units for everything else. One of either is singular. */
export function quantityNoun(assetType: InvestmentAssetType, quantityMinor: number): string {
  const one = BigInt(quantityMinor) === QUANTITY_FACTOR;
  if (SHARE_TYPES.has(assetType)) return one ? 'share' : 'shares';
  return one ? 'unit' : 'units';
}

/** `6 shares`, `2.5 units`. */
export function formatHoldingQuantity(
  quantityMinor: number,
  assetType: InvestmentAssetType,
  currency?: string,
): string {
  return (
    formatQuantityLabel(quantityMinor, currency) + ' ' + quantityNoun(assetType, quantityMinor)
  );
}

// Money

/**
 * `1,140.00`, `+1,140.00`, `−200.00`, or `NPR 1,140.00` with the code.
 *
 * For a figure inside a sentence or a compact line. A figure standing on its own
 * is a `<Money>`, which draws the same parts.
 */
export function formatAmount(
  minorUnits: number,
  currency: string,
  options: { code?: boolean; signed?: boolean } = {},
): string {
  const { negative, code, integer, decimals } = splitMinorUnits(minorUnits, currency);
  const sign = negative ? MINUS : options.signed && minorUnits > 0 ? '+' : '';
  return sign + (options.code ? code + ' ' : '') + integer + '.' + decimals;
}

const SPOKEN_CURRENCY: Record<string, string> = { NPR: 'rupees', INR: 'rupees', USD: 'dollars' };

/** `7,200 rupees`, `12.50 dollars`: an amount as a screen reader should say it. Always unsigned. */
export function speakAmount(minorUnits: number, currency: string): string {
  const { code, integer, decimals } = splitMinorUnits(Math.abs(minorUnits), currency);
  const unit = SPOKEN_CURRENCY[code] ?? code;
  return (decimals === '00' ? integer : integer + '.' + decimals) + ' ' + unit;
}

// Gains

export type GainKind = 'unrealized' | 'realized';

export type GainPresentation = {
  /** Said in words, so a gain never depends on colour alone. */
  label: 'Gain' | 'Loss' | 'No gain or loss';
  tone: 'positive' | 'negative' | 'secondary';
  /** Signed: `+1,140.00` or `−200.00`. */
  value: string;
  /** `Unrealized gain, 1,900 rupees` — never a bare `+1,900`. */
  accessibilityLabel: string;
};

export function presentGain(
  minorUnits: number,
  currency: string,
  kind: GainKind,
  options: { code?: boolean } = {},
): GainPresentation {
  const name = kind === 'unrealized' ? 'Unrealized' : 'Realized';
  const value = formatAmount(minorUnits, currency, { signed: true, code: options.code });
  if (minorUnits > 0) {
    return {
      label: 'Gain',
      tone: 'positive',
      value,
      accessibilityLabel: name + ' gain, ' + speakAmount(minorUnits, currency),
    };
  }
  if (minorUnits < 0) {
    return {
      label: 'Loss',
      tone: 'negative',
      value,
      accessibilityLabel: name + ' loss, ' + speakAmount(minorUnits, currency),
    };
  }
  return {
    label: 'No gain or loss',
    tone: 'secondary',
    value,
    accessibilityLabel: name + ' gain or loss, none',
  };
}

function gainPhrase(minorUnits: number, currency: string, kind: GainKind): string {
  if (minorUnits > 0) return kind + ' gain ' + speakAmount(minorUnits, currency);
  if (minorUnits < 0) return kind + ' loss ' + speakAmount(minorUnits, currency);
  return 'no ' + kind + ' gain or loss';
}

// Holdings

/** The row's second line: how much is held, at what average cost, at what price. */
export function holdingDetailLine(holding: AssetHolding): string {
  if (holding.status === 'invalid') return 'History needs attention';
  if (holding.quantityMinor === 0) {
    return holding.tradeCount === 0 ? 'No trades yet' : 'No current holdings';
  }
  const parts = [formatHoldingQuantity(holding.quantityMinor, holding.assetType, holding.currency)];
  if (holding.averageUnitCostMinor !== null) {
    parts.push('Avg ' + formatAmount(holding.averageUnitCostMinor, holding.currency));
  }
  if (holding.latestPrice !== null) {
    parts.push('Price ' + formatAmount(holding.latestPrice.priceMinor, holding.currency));
  }
  return parts.join(' · ');
}

/**
 * A holding read aloud in full:
 * `ABC Shares, 6 shares held, current value 7,200 rupees, unrealized gain 1,140 rupees.`
 */
export function holdingAccessibilityLabel(holding: AssetHolding): string {
  const parts = [holding.name];
  if (holding.symbol) parts.push(holding.symbol);
  const { currency } = holding;
  const held = formatHoldingQuantity(holding.quantityMinor, holding.assetType, currency) + ' held';

  switch (holding.status) {
    case 'invalid':
      parts.push('history needs attention, no figures shown');
      break;
    case 'closed':
      if (holding.tradeCount === 0) {
        parts.push('no trades yet');
      } else {
        parts.push(
          'no current holdings',
          gainPhrase(holding.realizedGainMinor, currency, 'realized'),
        );
      }
      break;
    case 'unpriced':
      parts.push(held, 'current value unavailable');
      break;
    case 'priced':
      parts.push(
        held,
        'current value ' + speakAmount(holding.marketValueMinor ?? 0, currency),
        gainPhrase(holding.unrealizedGainMinor ?? 0, currency, 'unrealized'),
      );
      break;
  }
  if (holding.isArchived) parts.push('archived');
  return parts.join(', ') + '.';
}

export type HoldingSegment = 'holdings' | 'closed' | 'archived';

export const HOLDING_SEGMENTS: { value: HoldingSegment; label: string }[] = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

/**
 * Which list an asset belongs in.
 *
 * An asset added a moment ago has no trades yet and is shown with the holdings,
 * where its first buy will make it one — putting it under Closed would look like
 * it had vanished. Closed is for a position that was held and fully sold.
 */
export function segmentOf(holding: AssetHolding): HoldingSegment {
  if (holding.isArchived) return 'archived';
  if (holding.status === 'closed' && holding.tradeCount > 0) return 'closed';
  return 'holdings';
}

/**
 * Current value, largest first; then everything without a value — unpriced,
 * awaiting a first trade, needing attention — by name. Ties go by name, then by
 * id, so the order is identical on every render and every device.
 */
export function sortHoldings(holdings: readonly AssetHolding[]): AssetHolding[] {
  return [...holdings].sort((left, right) => {
    const leftValue = left.status === 'priced' ? left.marketValueMinor : null;
    const rightValue = right.status === 'priced' ? right.marketValueMinor : null;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return rightValue - leftValue;
    }
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue === null && rightValue !== null) return 1;
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    if (leftName !== rightName) return leftName < rightName ? -1 : 1;
    return left.assetId - right.assetId;
  });
}

export function partitionHoldings(
  holdings: readonly AssetHolding[],
): Record<HoldingSegment, AssetHolding[]> {
  const lists: Record<HoldingSegment, AssetHolding[]> = { holdings: [], closed: [], archived: [] };
  for (const holding of holdings) lists[segmentOf(holding)].push(holding);
  return {
    holdings: sortHoldings(lists.holdings),
    closed: sortHoldings(lists.closed),
    archived: sortHoldings(lists.archived),
  };
}

// Portfolio

export function portfolioTitle(currency: string): string {
  return currency + ' Portfolio';
}

/** Whether a portfolio has anything to show: an asset, or one that needs attention. */
export function hasInvestmentData(summary: PortfolioSummary): boolean {
  return summary.currencies.length > 0 || summary.invalidAssetIds.length > 0;
}

/**
 * Why a currency's total is missing, and how much of it is known.
 *
 * Null when every open position is priced. A total is never shown with an unpriced
 * holding counted as zero, so the sentence says what is missing instead.
 */
export function describeValueAvailability(summary: CurrencyPortfolioSummary): string | null {
  const count = summary.unpricedPositionCount;
  if (count === 0) return null;
  const missing =
    (count === 1 ? '1 holding has' : count + ' holdings have') +
    ' no current price, so the total value is unavailable.';
  if (summary.pricedPositionCount === 0) return missing;
  return (
    missing +
    ' Priced holdings are worth ' +
    formatAmount(summary.pricedMarketValueMinor, summary.currency, { code: true }) +
    '.'
  );
}

export function portfolioAccessibilityLabel(summary: CurrencyPortfolioSummary): string {
  const { currency } = summary;
  const parts = [portfolioTitle(currency)];
  parts.push(
    summary.marketValueMinor === null
      ? 'current value unavailable'
      : 'current value ' + speakAmount(summary.marketValueMinor, currency),
    'cost basis ' + speakAmount(summary.costBasisMinor, currency),
  );
  if (summary.unrealizedGainMinor !== null) {
    parts.push(gainPhrase(summary.unrealizedGainMinor, currency, 'unrealized'));
  }
  parts.push(gainPhrase(summary.realizedGainMinor, currency, 'realized'));
  return parts.join(', ') + '.';
}

// Dates

/** `Sep 13`, or `Sep 13, 2025` outside the current year. From a `YYYY-MM-DD` calendar date. */
export function formatLocalDateLabel(
  localDate: string,
  options: { today?: Date; year?: 'always' | 'when-different' } = {},
): string {
  const [year = 1970, month = 1, day = 1] = localDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = options.today ?? new Date();
  const showYear = options.year !== 'when-different' || year !== today.getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  }).format(date);
}

/** `Price updated Sep 13`. */
export function priceUpdatedLabel(priceDate: string, today: Date = new Date()): string {
  return 'Price updated ' + formatLocalDateLabel(priceDate, { today, year: 'when-different' });
}

export function formatTradeDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

// Trades

/** `10 shares at 1,000.00 · Fee 100.00`; for cash-only events, what the cash was. */
export function tradeDetailLine(trade: TradeHistoryEntry, assetType: InvestmentAssetType): string {
  switch (trade.tradeType) {
    case 'buy':
    case 'sell': {
      const parts = [
        formatHoldingQuantity(trade.quantityMinor ?? 0, assetType, trade.currency) +
          ' at ' +
          formatAmount(trade.unitPriceMinor ?? 0, trade.currency),
      ];
      if (trade.feeMinor > 0) parts.push('Fee ' + formatAmount(trade.feeMinor, trade.currency));
      return parts.join(' · ');
    }
    case 'dividend':
      return 'Investment Return income';
    case 'fee':
      return 'Charged on its own';
  }
}

/** `From Bank` for cash that left an account, `To Bank` for cash that arrived. */
export function tradeAccountLine(trade: TradeHistoryEntry): string {
  const account = trade.accountName ?? 'Unknown account';
  return (trade.cashEffect.direction === 'out' ? 'From ' : 'To ') + account;
}

/** The colour and sign of a trade's cash, which is money leaving or entering an account. */
export function tradeCashDirection(trade: TradeHistoryEntry): 'expense' | 'income' {
  return trade.cashEffect.direction === 'out' ? 'expense' : 'income';
}

export function tradeAccessibilityLabel(
  trade: TradeHistoryEntry,
  assetType: InvestmentAssetType,
): string {
  const { currency } = trade;
  const parts = [TRADE_TYPE_LABELS[trade.tradeType], formatTradeDate(trade.tradeDate)];
  if (trade.tradeType === 'buy' || trade.tradeType === 'sell') {
    parts.push(
      formatHoldingQuantity(trade.quantityMinor ?? 0, assetType, currency) +
        ' at ' +
        speakAmount(trade.unitPriceMinor ?? 0, currency) +
        ' each',
    );
    if (trade.feeMinor > 0) parts.push('fee ' + speakAmount(trade.feeMinor, currency));
  }
  const cash = speakAmount(trade.cashEffect.amountMinor, currency);
  const account = trade.accountName ?? 'an unknown account';
  parts.push(
    trade.cashEffect.direction === 'out'
      ? cash + ' paid from ' + account
      : cash + ' paid into ' + account,
  );
  return parts.join(', ') + '.';
}

/** What deleting a trade does, said before it happens. */
export function deleteTradeCopy(trade: Pick<TradeHistoryEntry, 'tradeType'>): {
  title: string;
  message: string;
} {
  switch (trade.tradeType) {
    case 'buy':
      return {
        title: 'Delete this buy?',
        message:
          'Deleting this buy may affect later holdings and gains, and returns its cash to the account. If a later sale depends on it, nothing is deleted.',
      };
    case 'sell':
      return {
        title: 'Delete this sale?',
        message:
          'Deleting this sale may affect later holdings and gains, and removes the cash it paid into the account.',
      };
    case 'dividend':
      return {
        title: 'Delete this dividend?',
        message:
          'Deleting this dividend removes its cash from the account and from Investment Return income.',
      };
    case 'fee':
      return {
        title: 'Delete this fee?',
        message: 'Deleting this fee returns its cash to the account.',
      };
  }
}

// Forms

export type ParsedInput = { ok: true; value: number } | { ok: false; error: string | null };

/** A typed quantity, exactly, or why not. An empty field is not an error yet. */
export function readQuantityInput(text: string): ParsedInput {
  if (text.trim() === '') return { ok: false, error: null };
  try {
    return { ok: true, value: parseQuantity(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Enter a quantity.' };
  }
}

/** A typed amount in minor units, or why not. An empty optional field is zero. */
export function readAmountInput(text: string, options: { optional?: boolean } = {}): ParsedInput {
  if (text.trim() === '')
    return options.optional ? { ok: true, value: 0 } : { ok: false, error: null };
  const minorUnits = parseMoneyToMinorUnits(text);
  if (minorUnits === null || minorUnits < 0) {
    return { ok: false, error: 'Enter an amount like 1250 or 1250.50.' };
  }
  if (minorUnits === 0 && !options.optional) {
    return { ok: false, error: 'Enter an amount greater than 0.' };
  }
  return { ok: true, value: minorUnits };
}

/** A stored quantity as editable text: `6`, `1.25`. No grouping, so it parses back exactly. */
export function quantityInputText(quantityMinor: number): string {
  return formatQuantity(quantityMinor);
}

/** Stored minor units as editable text: `1000.00`. No grouping, so it parses back exactly. */
export function amountInputText(minorUnits: number): string {
  return String(Math.floor(minorUnits / 100)) + '.' + String(minorUnits % 100).padStart(2, '0');
}

/** The calendar day a picked date falls on, as a price is stored: `YYYY-MM-DD`. */
export function localDateText(date: Date): string {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

/** A stored `YYYY-MM-DD` as a date a picker can open on, at local midnight. */
export function dateOfLocalDate(localDate: string): Date {
  const [year = 1970, month = 1, day = 1] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `Available: 6 shares`. */
export function availableLabel(
  availableMinor: number,
  assetType: InvestmentAssetType,
  currency: string,
): string {
  return 'Available: ' + formatHoldingQuantity(availableMinor, assetType, currency);
}

/** The inline refusal before the service is asked. The service still decides. */
export function sellQuantityError(
  quantityMinor: number,
  availableMinor: number,
  assetType: InvestmentAssetType,
  currency: string,
): string | null {
  if (quantityMinor <= availableMinor) return null;
  if (availableMinor === 0) return 'Nothing is available to sell on this date.';
  return (
    'You can sell up to ' +
    formatHoldingQuantity(availableMinor, assetType, currency) +
    ' on this date.'
  );
}

export function describeBuyEffect(accountName?: string): string {
  return (
    'This moves cash from ' +
    (accountName ?? 'the account you choose') +
    ' into this investment. It is not an expense, and budgets do not change.'
  );
}

export function describeSellEffect(accountName?: string): string {
  return (
    'This returns cash to ' +
    (accountName ?? 'the account you choose') +
    '. It is not income; any profit is shown as realized gain.'
  );
}

/**
 * A dividend is Investment Return income — M10A records it as an ordinary income
 * transaction in that category — so the form says both things it will do.
 */
export function describeDividendEffect(accountName?: string): string[] {
  return [
    'This will add cash to ' + (accountName ?? 'the account you choose') + '.',
    'This will also appear as Investment Return income.',
  ];
}

export const PRICE_EFFECT_NOTE =
  'A price changes only the current value and unrealized gain. No cash moves, and no income or expense is recorded.';

export const ADD_ASSET_NOTE =
  'Adding an investment moves no money and creates no transaction. Record a buy to start a holding.';

export const SYNC_ATTENTION_NOTE =
  'Sync needs attention. These figures may not include changes from your other devices until it is resolved.';

// Errors

export type InvestmentAction = 'buy' | 'sell' | 'dividend' | 'edit' | 'delete' | 'price' | 'asset';

/**
 * A refusal as a sentence for the screen that caused it.
 *
 * A history violation is never shown as the domain phrased it: "held 6, selling 7"
 * is a diagnosis, and the person needs to know what to change.
 */
export function describeInvestmentError(error: unknown, action: InvestmentAction): string {
  if (error instanceof InvestmentHistoryError) {
    return action === 'sell'
      ? 'This sale is more than is available on that date, including what later sales need.'
      : 'This change would make later investment history invalid.';
  }
  if (error instanceof InvestmentValidationError) {
    if (error.code === 'asset_archived') {
      return 'This investment is archived. Unarchive it to record new trades.';
    }
    if (error.code === 'account_archived') {
      return 'That account has been archived. Choose an active account.';
    }
    return error.message;
  }
  if (error instanceof NotFoundError) {
    return 'This record is no longer available. It may have been changed on another device.';
  }
  return getUserErrorMessage(error);
}
