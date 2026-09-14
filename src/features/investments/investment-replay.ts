import type { InvestmentTradeType } from '@/db/constants';

import { proportionalCost, valueAtPrice } from './investment-math';

/**
 * Holdings, cost basis and realized gain, derived by replaying trades in order.
 *
 * Nothing here is stored anywhere. A holding is what its trades say, recomputed
 * every time, so there is no current quantity that could drift from the history
 * that produced it and no cached gain that could survive an edit it should not.
 *
 * **Order.** Trades replay by `tradeDate`, then `createdAt`, then `syncId`. Every
 * one of those travels with the trade to every device, so every device replays
 * the same trades in the same order and reaches the same figures — a local row
 * id would not, because two devices number rows differently. Trades recorded on
 * the same day replay in the order they were entered. The cloud's holdings guard
 * orders by exactly the same three columns.
 *
 * **Weighted average cost**, the one method supported:
 *
 * - A buy adds its quantity, and adds its gross cost plus its fee to the basis.
 * - A sell removes its quantity and the proportional share of the basis for it,
 *   so what remains keeps the same average cost. Selling the whole holding takes
 *   the whole basis. Realized gain is the net proceeds — gross minus the sell
 *   fee — minus that share of basis.
 * - A dividend changes neither quantity nor basis. It is counted separately.
 * - A standalone fee changes neither quantity nor basis. It is counted
 *   separately, not folded into realized gain from selling.
 *
 * **A sell of more than is held at that point in the history is a violation**,
 * wherever the sell sits: the history is invalid, not merely the last figure. No
 * short selling, no negative holding, ever.
 */

export type TradeOrderKey = { tradeDate: number; createdAt: number; syncId: string };

export type ReplayTrade = TradeOrderKey & {
  tradeType: InvestmentTradeType;
  quantityMinor: number | null;
  unitPriceMinor: number | null;
  feeMinor: number;
  amountMinor: number | null;
};

export type HoldingPosition = {
  quantityMinor: bigint;
  costBasisMinor: bigint;
  /** From sells only: net proceeds minus the basis they removed. */
  realizedGainMinor: bigint;
  dividendsMinor: bigint;
  /** Standalone fee trades. Buy and sell fees are inside basis and proceeds. */
  otherFeesMinor: bigint;
  /** Every buy's gross cost plus its fee: the cash that went in. */
  investedMinor: bigint;
  /** Every sell's gross proceeds minus its fee: the cash that came back. */
  proceedsMinor: bigint;
  tradeCount: number;
};

export type ReplayViolation = {
  syncId: string;
  heldQuantityMinor: bigint;
  soldQuantityMinor: bigint;
};

export type ReplayResult =
  | { ok: true; position: HoldingPosition }
  /** `position` is the state just before the violating sell. */
  | { ok: false; violation: ReplayViolation; position: HoldingPosition };

const ZERO = BigInt(0);

export function compareTrades(left: TradeOrderKey, right: TradeOrderKey): number {
  return (
    left.tradeDate - right.tradeDate ||
    left.createdAt - right.createdAt ||
    (left.syncId < right.syncId ? -1 : left.syncId > right.syncId ? 1 : 0)
  );
}

export function emptyPosition(): HoldingPosition {
  return {
    quantityMinor: ZERO,
    costBasisMinor: ZERO,
    realizedGainMinor: ZERO,
    dividendsMinor: ZERO,
    otherFeesMinor: ZERO,
    investedMinor: ZERO,
    proceedsMinor: ZERO,
    tradeCount: 0,
  };
}

/** Replays one asset's trades. The input order does not matter; it is sorted here. */
export function replayTrades(trades: readonly ReplayTrade[]): ReplayResult {
  const position = emptyPosition();
  for (const trade of [...trades].sort(compareTrades)) {
    const violation = applyTrade(position, trade);
    if (violation !== undefined) return { ok: false, violation, position };
  }
  return { ok: true, position };
}

/** The holding just after one trade of a replay. */
export type ReplayStep = {
  syncId: string;
  quantityMinor: bigint;
  realizedGainMinor: bigint;
};

/**
 * Replays exactly as `replayTrades` does, recording the holding after every trade.
 *
 * For questions about a point inside a history rather than its end: how many units
 * a sale on a given day may take without a later sale overselling, and what that
 * one sale realized. `steps` stops at a violation, like the replay itself.
 */
export function replayTradeSteps(trades: readonly ReplayTrade[]): {
  result: ReplayResult;
  steps: ReplayStep[];
} {
  const position = emptyPosition();
  const steps: ReplayStep[] = [];
  for (const trade of [...trades].sort(compareTrades)) {
    const violation = applyTrade(position, trade);
    if (violation !== undefined) return { result: { ok: false, violation, position }, steps };
    steps.push({
      syncId: trade.syncId,
      quantityMinor: position.quantityMinor,
      realizedGainMinor: position.realizedGainMinor,
    });
  }
  return { result: { ok: true, position }, steps };
}

function applyTrade(position: HoldingPosition, trade: ReplayTrade): ReplayViolation | undefined {
  switch (trade.tradeType) {
    case 'buy': {
      const quantity = BigInt(required(trade.quantityMinor, trade, 'quantity'));
      const gross = valueAtPrice(quantity, BigInt(required(trade.unitPriceMinor, trade, 'price')));
      position.quantityMinor += quantity;
      position.costBasisMinor += gross + BigInt(trade.feeMinor);
      position.investedMinor += gross + BigInt(trade.feeMinor);
      break;
    }
    case 'sell': {
      const quantity = BigInt(required(trade.quantityMinor, trade, 'quantity'));
      if (quantity > position.quantityMinor) {
        return {
          syncId: trade.syncId,
          heldQuantityMinor: position.quantityMinor,
          soldQuantityMinor: quantity,
        };
      }
      const gross = valueAtPrice(quantity, BigInt(required(trade.unitPriceMinor, trade, 'price')));
      const basisSold = proportionalCost(position.costBasisMinor, quantity, position.quantityMinor);
      position.realizedGainMinor += gross - BigInt(trade.feeMinor) - basisSold;
      position.proceedsMinor += gross - BigInt(trade.feeMinor);
      position.costBasisMinor -= basisSold;
      position.quantityMinor -= quantity;
      break;
    }
    case 'dividend':
      position.dividendsMinor += BigInt(required(trade.amountMinor, trade, 'amount'));
      break;
    case 'fee':
      position.otherFeesMinor += BigInt(required(trade.amountMinor, trade, 'amount'));
      break;
  }
  position.tradeCount += 1;
  return undefined;
}

/**
 * The schema's check constraints make these impossible for a stored trade, so a
 * missing figure is a programming error rather than a state to replay around.
 */
function required(value: number | null, trade: ReplayTrade, field: string): number {
  if (value === null) {
    throw new Error(`Investment ${trade.tradeType} ${trade.syncId} has no ${field}.`);
  }
  return value;
}
