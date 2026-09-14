import { NotFoundError } from '@/features/shared/errors';
import { requireSyncId } from '@/features/sync/uuid';

import * as repository from './investment.repository';
import { toSafeInteger, valueAtPrice } from './investment-math';
import { replayTradeSteps, type ReplayTrade, type TradeOrderKey } from './investment-replay';
import { cashEffectOf, toReplayTrade } from './investment.service';
import {
  normalizeFeeMinor,
  normalizePositiveMinor,
  normalizeQuantityMinor,
  normalizeTradeDate,
} from './investment.validation';

/**
 * What a buy or a sale will do, before it is recorded.
 *
 * A form shows these figures above Record Buy and Record Sell. They come from the
 * arithmetic and the replay that recording itself uses — `cashEffectOf` for the
 * cash, the asset's history with the trade in place for the gain — so a preview
 * cannot disagree with what the saved trade produces. Nothing here writes.
 */

/** Stands in for the identity a new trade receives when it is recorded. */
const DRAFT_SYNC_ID = 'draft';

export type QuantityTradeDraft = {
  quantityMinor: number;
  unitPriceMinor: number;
  feeMinor?: number;
};

export type BuyPreview = {
  /** Quantity × unit price, rounded half up to a minor unit. */
  grossMinor: number;
  feeMinor: number;
  /** What leaves the account: the purchase value plus the fee. */
  totalCashOutflowMinor: number;
};

export type SellDraft = QuantityTradeDraft & {
  assetId: number;
  tradeDate: Date;
  /** When editing a sale, that sale: it is left out of what is available. */
  replacingTradeId?: number;
};

export type SellPreview = {
  grossMinor: number;
  feeMinor: number;
  /** What enters the account: gross proceeds less the fee. */
  netCashReceivedMinor: number;
  /**
   * What this sale alone realizes at its place in the history. Null when the sale
   * is more than can be sold there, because a sale that cannot be recorded
   * realizes nothing.
   */
  realizedGainMinor: number | null;
  /** What is held once the sale is recorded. Null when it cannot be. */
  remainingQuantityMinor: number | null;
};

/** Refuses what `buyAsset` would refuse: a purchase worth nothing, or a figure too large. */
export function previewBuy(draft: QuantityTradeDraft): BuyPreview {
  const quantityMinor = normalizeQuantityMinor(draft.quantityMinor);
  const unitPriceMinor = normalizePositiveMinor(draft.unitPriceMinor, 'Unit price');
  const feeMinor = normalizeFeeMinor(draft.feeMinor);
  const effect = cashEffectOf({
    tradeType: 'buy',
    quantityMinor,
    unitPriceMinor,
    feeMinor,
    amountMinor: null,
  });
  return {
    grossMinor: grossOf(quantityMinor, unitPriceMinor),
    feeMinor,
    totalCashOutflowMinor: effect.amountMinor,
  };
}

/**
 * The most a sale dated `tradeDate` can take.
 *
 * Not simply what is held today. A backdated sale has to fit what was held on its
 * date, and has to leave enough for every sale after it. So this is the smallest
 * holding from the sale's place in the history to the end of it. A history that
 * is already invalid can sell nothing more.
 */
export function getSellableQuantity(
  assetId: number,
  tradeDate: Date,
  options: { replacingTradeId?: number } = {},
): number {
  const { others, key } = placeDraft(assetId, tradeDate, options.replacingTradeId);
  // A sale of nothing leaves every later holding exactly as it is, so the replay
  // reads the holding at the sale's place without changing anything after it.
  const probe: ReplayTrade = {
    ...key,
    tradeType: 'sell',
    quantityMinor: 0,
    unitPriceMinor: 1,
    feeMinor: 0,
    amountMinor: null,
  };
  const { result, steps } = replayTradeSteps([...others, probe]);
  if (!result.ok) return 0;

  const start = steps.findIndex((step) => step.syncId === key.syncId);
  let smallest: bigint | null = null;
  for (const step of steps.slice(start)) {
    if (smallest === null || step.quantityMinor < smallest) smallest = step.quantityMinor;
  }
  return toSafeInteger(smallest ?? BigInt(0), 'Available quantity');
}

/** Refuses what `sellAsset` would refuse about the figures; reports an oversell as nulls. */
export function previewSell(draft: SellDraft): SellPreview {
  const quantityMinor = normalizeQuantityMinor(draft.quantityMinor);
  const unitPriceMinor = normalizePositiveMinor(draft.unitPriceMinor, 'Unit price');
  const feeMinor = normalizeFeeMinor(draft.feeMinor);
  const effect = cashEffectOf({
    tradeType: 'sell',
    quantityMinor,
    unitPriceMinor,
    feeMinor,
    amountMinor: null,
  });
  const base = {
    grossMinor: grossOf(quantityMinor, unitPriceMinor),
    feeMinor,
    netCashReceivedMinor: effect.amountMinor,
  };

  const { others, key } = placeDraft(draft.assetId, draft.tradeDate, draft.replacingTradeId);
  const sale: ReplayTrade = {
    ...key,
    tradeType: 'sell',
    quantityMinor,
    unitPriceMinor,
    feeMinor,
    amountMinor: null,
  };
  const { result, steps } = replayTradeSteps([...others, sale]);
  if (!result.ok) return { ...base, realizedGainMinor: null, remainingQuantityMinor: null };

  const index = steps.findIndex((step) => step.syncId === key.syncId);
  const before = index > 0 ? steps[index - 1]!.realizedGainMinor : BigInt(0);
  return {
    ...base,
    realizedGainMinor: toSafeInteger(steps[index]!.realizedGainMinor - before, 'Realized gain'),
    remainingQuantityMinor: toSafeInteger(result.position.quantityMinor, 'Holding quantity'),
  };
}

/**
 * The asset's other trades, and where a draft trade dated `tradeDate` sits among
 * them — exactly where recording would put it. A new trade lands after every
 * trade already on its date; an edited one keeps its own entry time and identity.
 */
function placeDraft(
  assetId: number,
  tradeDate: Date,
  replacingTradeId: number | undefined,
): { others: ReplayTrade[]; key: TradeOrderKey } {
  if (repository.getAssetById(assetId) === null) {
    throw new NotFoundError(`Investment asset ${assetId} was not found.`);
  }
  const date = normalizeTradeDate(tradeDate).getTime();
  const trades = repository.listTradesForAsset(assetId);

  if (replacingTradeId !== undefined) {
    const replacing = trades.find((trade) => trade.id === replacingTradeId);
    if (replacing === undefined) {
      throw new NotFoundError(`Investment trade ${replacingTradeId} was not found.`);
    }
    return {
      others: trades
        .filter((trade) => trade.id !== replacingTradeId)
        .map((trade) => toReplayTrade(trade)),
      key: {
        tradeDate: date,
        createdAt: replacing.createdAt.getTime(),
        syncId: requireSyncId(replacing.syncId, 'investment trade'),
      },
    };
  }

  const lastForDate = trades.reduce(
    (latest, trade) =>
      trade.tradeDate.getTime() === date ? Math.max(latest, trade.createdAt.getTime()) : latest,
    Number.NEGATIVE_INFINITY,
  );
  return {
    others: trades.map((trade) => toReplayTrade(trade)),
    key: {
      tradeDate: date,
      createdAt: Math.max(Date.now(), lastForDate + 1),
      syncId: DRAFT_SYNC_ID,
    },
  };
}

function grossOf(quantityMinor: number, unitPriceMinor: number): number {
  return toSafeInteger(valueAtPrice(BigInt(quantityMinor), BigInt(unitPriceMinor)), 'Trade value');
}
