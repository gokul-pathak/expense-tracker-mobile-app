import { localDateOf } from '@/features/recurring/recurring-schedule';
import { NotFoundError } from '@/features/shared/errors';

import * as repository from './investment.repository';
import { averageUnitCost, toSafeInteger, valueAtPrice } from './investment-math';
import { replayTrades, type HoldingPosition } from './investment-replay';
import { toReplayTrade } from './investment.service';
import type {
  AssetHolding,
  AssetPerformance,
  CurrencyPortfolioSummary,
  InvestmentAsset,
  InvestmentPrice,
  InvestmentTrade,
  PortfolioSummary,
} from './investment.types';

/**
 * Holdings, valuation and the portfolio, derived from source records every time.
 *
 * Nothing is cached and nothing is stored: a holding is its trades replayed, a
 * value is that holding at the latest manual price on or before the day asked
 * about. A portfolio is read in three queries — assets, every live trade in
 * replay order, and the latest price per asset — however many assets there are.
 *
 * Two distinctions are kept everywhere, because blurring either one produces a
 * number someone would act on and should not:
 *
 * - **Unknown is not zero.** A position nobody has priced has no market value.
 *   It is never valued at zero, and never at its last purchase price.
 * - **Currencies are never added.** The portfolio is one summary per currency.
 *
 * Investment Value is not part of Total Balance, which stays cash in accounts.
 */

export type ValuationOptions = {
  /** Values at the latest price on or before this day. Defaults to today. */
  asOf?: Date;
};

export function getHolding(assetId: number, options: ValuationOptions = {}): AssetHolding {
  return getAssetPerformance(assetId, options);
}

export function getAssetPerformance(
  assetId: number,
  options: ValuationOptions = {},
): AssetPerformance {
  const asset = repository.getAssetById(assetId);
  if (asset === null) throw new NotFoundError(`Investment asset ${assetId} was not found.`);
  const trades = repository.listTradesForAsset(assetId);
  const price = repository.getLatestPrice(assetId, localDateOf(options.asOf ?? new Date()));
  return evaluate(asset, trades, price);
}

/** Every live asset, archived and closed ones included, in name order. */
export function listHoldings(options: ValuationOptions = {}): AssetHolding[] {
  const assets = repository.listAssets();
  const tradesByAsset = new Map<number, InvestmentTrade[]>();
  for (const trade of repository.listAllLiveTrades()) {
    const list = tradesByAsset.get(trade.assetId);
    if (list === undefined) tradesByAsset.set(trade.assetId, [trade]);
    else list.push(trade);
  }
  const prices = repository.listLatestPrices(localDateOf(options.asOf ?? new Date()));
  return assets.map((asset) =>
    evaluate(asset, tradesByAsset.get(asset.id) ?? [], prices.get(asset.id) ?? null),
  );
}

export function getPortfolioSummary(options: ValuationOptions = {}): PortfolioSummary {
  type Bucket = {
    assetCount: number;
    openPositionCount: number;
    pricedPositionCount: number;
    unpricedPositionCount: number;
    costBasis: bigint;
    pricedCostBasis: bigint;
    pricedMarketValue: bigint;
    pricedUnrealizedGain: bigint;
    realizedGain: bigint;
    dividends: bigint;
    otherFees: bigint;
  };
  const buckets = new Map<string, Bucket>();
  const invalidAssetIds: number[] = [];
  const zero = BigInt(0);

  for (const holding of listHoldings(options)) {
    if (holding.status === 'invalid') {
      invalidAssetIds.push(holding.assetId);
      continue;
    }
    let bucket = buckets.get(holding.currency);
    if (bucket === undefined) {
      bucket = {
        assetCount: 0,
        openPositionCount: 0,
        pricedPositionCount: 0,
        unpricedPositionCount: 0,
        costBasis: zero,
        pricedCostBasis: zero,
        pricedMarketValue: zero,
        pricedUnrealizedGain: zero,
        realizedGain: zero,
        dividends: zero,
        otherFees: zero,
      };
      buckets.set(holding.currency, bucket);
    }
    bucket.assetCount += 1;
    bucket.realizedGain += BigInt(holding.realizedGainMinor);
    bucket.dividends += BigInt(holding.dividendsMinor);
    bucket.otherFees += BigInt(holding.otherFeesMinor);
    if (holding.status === 'closed') continue;

    bucket.openPositionCount += 1;
    bucket.costBasis += BigInt(holding.costBasisMinor);
    if (holding.status === 'priced') {
      bucket.pricedPositionCount += 1;
      bucket.pricedCostBasis += BigInt(holding.costBasisMinor);
      bucket.pricedMarketValue += BigInt(holding.marketValueMinor ?? 0);
      bucket.pricedUnrealizedGain += BigInt(holding.unrealizedGainMinor ?? 0);
    } else {
      bucket.unpricedPositionCount += 1;
    }
  }

  const currencies: CurrencyPortfolioSummary[] = [...buckets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([currency, bucket]) => {
      const complete = bucket.unpricedPositionCount === 0;
      const pricedMarketValueMinor = toSafeInteger(bucket.pricedMarketValue, 'Investment value');
      const pricedUnrealizedGainMinor = toSafeInteger(
        bucket.pricedUnrealizedGain,
        'Unrealized gain',
      );
      return {
        currency,
        assetCount: bucket.assetCount,
        openPositionCount: bucket.openPositionCount,
        pricedPositionCount: bucket.pricedPositionCount,
        unpricedPositionCount: bucket.unpricedPositionCount,
        costBasisMinor: toSafeInteger(bucket.costBasis, 'Cost basis'),
        pricedCostBasisMinor: toSafeInteger(bucket.pricedCostBasis, 'Cost basis'),
        marketValueMinor: complete ? pricedMarketValueMinor : null,
        pricedMarketValueMinor,
        unrealizedGainMinor: complete ? pricedUnrealizedGainMinor : null,
        pricedUnrealizedGainMinor,
        realizedGainMinor: toSafeInteger(bucket.realizedGain, 'Realized gain'),
        dividendsMinor: toSafeInteger(bucket.dividends, 'Dividends'),
        otherFeesMinor: toSafeInteger(bucket.otherFees, 'Fees'),
      };
    });

  return { currencies, invalidAssetIds };
}

function evaluate(
  asset: InvestmentAsset,
  trades: readonly InvestmentTrade[],
  price: InvestmentPrice | null,
): AssetPerformance {
  const latestPrice =
    price === null ? null : { priceMinor: price.priceMinor, priceDate: price.priceDate };
  const base = {
    assetId: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    assetType: asset.assetType,
    currency: asset.currency,
    isArchived: asset.isArchived,
    tradeCount: trades.length,
    latestPrice,
    firstTradeDate: firstDate(trades),
    lastTradeDate: lastDate(trades),
  };

  const result = replayTrades(trades.map((trade) => toReplayTrade(trade)));
  if (!result.ok) {
    // A history that sells more than it holds has no meaningful figures. Every
    // number is zero only so the shape stays usable; `status` says to ignore them.
    return {
      ...base,
      status: 'invalid',
      quantityMinor: 0,
      costBasisMinor: 0,
      averageUnitCostMinor: null,
      realizedGainMinor: 0,
      dividendsMinor: 0,
      otherFeesMinor: 0,
      marketValueMinor: null,
      unrealizedGainMinor: null,
      investedMinor: 0,
      proceedsMinor: 0,
    };
  }

  const { position } = result;
  const figures = figuresOf(position);
  const zero = BigInt(0);

  if (position.quantityMinor === zero) {
    return { ...base, ...figures, status: 'closed', marketValueMinor: 0, unrealizedGainMinor: 0 };
  }
  if (price === null) {
    return {
      ...base,
      ...figures,
      status: 'unpriced',
      marketValueMinor: null,
      unrealizedGainMinor: null,
    };
  }
  const marketValue = valueAtPrice(position.quantityMinor, BigInt(price.priceMinor));
  return {
    ...base,
    ...figures,
    status: 'priced',
    marketValueMinor: toSafeInteger(marketValue, 'Market value'),
    unrealizedGainMinor: toSafeInteger(marketValue - position.costBasisMinor, 'Unrealized gain'),
  };
}

function figuresOf(position: HoldingPosition) {
  const average = averageUnitCost(position.costBasisMinor, position.quantityMinor);
  return {
    quantityMinor: toSafeInteger(position.quantityMinor, 'Holding quantity'),
    costBasisMinor: toSafeInteger(position.costBasisMinor, 'Cost basis'),
    averageUnitCostMinor: average === null ? null : toSafeInteger(average, 'Average cost'),
    realizedGainMinor: toSafeInteger(position.realizedGainMinor, 'Realized gain'),
    dividendsMinor: toSafeInteger(position.dividendsMinor, 'Dividends'),
    otherFeesMinor: toSafeInteger(position.otherFeesMinor, 'Fees'),
    investedMinor: toSafeInteger(position.investedMinor, 'Amount invested'),
    proceedsMinor: toSafeInteger(position.proceedsMinor, 'Sale proceeds'),
  };
}

function firstDate(trades: readonly InvestmentTrade[]): Date | null {
  let first: Date | null = null;
  for (const trade of trades) {
    if (first === null || trade.tradeDate < first) first = trade.tradeDate;
  }
  return first;
}

function lastDate(trades: readonly InvestmentTrade[]): Date | null {
  let last: Date | null = null;
  for (const trade of trades) {
    if (last === null || trade.tradeDate > last) last = trade.tradeDate;
  }
  return last;
}
