import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db';
import { categories } from '@/db/schema/categories';
import { investmentAssets, investmentPrices, investmentTrades } from '@/db/schema/investments';
import { transactions } from '@/db/schema/transactions';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import type { SyncWriter } from '@/features/sync/sync.types';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';
import {
  deleteTransactionWithin,
  insertTransaction,
  updateTransactionWithin,
} from '@/features/transactions/transaction.repository';
import type {
  CreateTransactionRecord,
  UpdateTransactionRecord,
} from '@/features/transactions/transaction.types';

import type {
  CreateAssetRecord,
  CreatePriceRecord,
  CreateTradeRecord,
  InvestmentAsset,
  InvestmentPrice,
  InvestmentTrade,
  UpdateAssetRecord,
  UpdatePriceRecord,
  UpdateTradeRecord,
} from './investment.types';

/**
 * Reading and writing investment source records.
 *
 * Every user mutation writes its row and its sync queue entry in one SQLite
 * transaction. A trade goes further: the trade, its cash transaction and both
 * queue entries are one transaction, so a trade never exists without the cash it
 * moved, and cash never moves for a trade that does not exist.
 *
 * Tombstoned rows are hidden from every read here. Nothing in this file decides
 * whether a change is allowed — that is `investment.service.ts`, which replays
 * the history first.
 */

const liveAsset = isNull(investmentAssets.deletedAt);
const liveTrade = isNull(investmentTrades.deletedAt);
const livePrice = isNull(investmentPrices.deletedAt);

/** Replay order: date, then entry order, then identity. See `investment-replay.ts`. */
const tradeOrder = [
  asc(investmentTrades.tradeDate),
  asc(investmentTrades.createdAt),
  asc(investmentTrades.syncId),
] as const;

// Assets

export function createAsset(data: CreateAssetRecord): InvestmentAsset {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const asset = tx
      .insert(investmentAssets)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'investment_asset',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return asset;
  });
}

export function updateAsset(id: number, data: UpdateAssetRecord): InvestmentAsset | null {
  return db.transaction((tx) => {
    const asset =
      tx
        .update(investmentAssets)
        .set(data)
        .where(and(liveAsset, eq(investmentAssets.id, id)))
        .returning()
        .get() ?? null;
    if (asset === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'investment_asset',
      entitySyncId: requireSyncId(asset.syncId, 'investment asset'),
      operation: 'upsert',
    });
    return asset;
  });
}

export function getAssetById(id: number): InvestmentAsset | null {
  return (
    db
      .select()
      .from(investmentAssets)
      .where(and(liveAsset, eq(investmentAssets.id, id)))
      .get() ?? null
  );
}

/** Every live asset, archived ones included. */
export function listAssets(): InvestmentAsset[] {
  return db
    .select()
    .from(investmentAssets)
    .where(liveAsset)
    .orderBy(asc(investmentAssets.name), asc(investmentAssets.id))
    .all();
}

export function countLiveTradesForAsset(assetId: number): number {
  return (
    db
      .select({ total: sql<number>`count(*)` })
      .from(investmentTrades)
      .where(and(liveTrade, eq(investmentTrades.assetId, assetId)))
      .get()?.total ?? 0
  );
}

export function countLivePricesForAsset(assetId: number): number {
  return (
    db
      .select({ total: sql<number>`count(*)` })
      .from(investmentPrices)
      .where(and(livePrice, eq(investmentPrices.assetId, assetId)))
      .get()?.total ?? 0
  );
}

// Trades

export function getTradeById(id: number): InvestmentTrade | null {
  return (
    db
      .select()
      .from(investmentTrades)
      .where(and(liveTrade, eq(investmentTrades.id, id)))
      .get() ?? null
  );
}

/** One asset's live history, in replay order. */
export function listTradesForAsset(assetId: number): InvestmentTrade[] {
  return db
    .select()
    .from(investmentTrades)
    .where(and(liveTrade, eq(investmentTrades.assetId, assetId)))
    .orderBy(...tradeOrder)
    .all();
}

/** Every live trade, grouped by asset and in replay order within each: one query for a portfolio. */
export function listAllLiveTrades(): InvestmentTrade[] {
  return db
    .select()
    .from(investmentTrades)
    .where(liveTrade)
    .orderBy(asc(investmentTrades.assetId), ...tradeOrder)
    .all();
}

/** The cash transaction a trade moved, live or not. */
export function getLinkedTransaction(tradeId: number, writer: SyncWriter = db) {
  return (
    writer.select().from(transactions).where(eq(transactions.investmentTradeId, tradeId)).get() ??
    null
  );
}

/**
 * Records a trade and the cash it moved, atomically.
 *
 * The identity is chosen by the caller, because the caller has already replayed
 * the asset's history with the trade in its place, and a trade's place in that
 * order depends on its identity when two trades share a date and a moment.
 */
export function insertTradeWithCash(
  syncId: string,
  trade: CreateTradeRecord,
  cash: CreateTransactionRecord,
) {
  const identity = requireSyncId(syncId, 'investment trade');
  return db.transaction((tx) => {
    const row = tx
      .insert(investmentTrades)
      .values({ ...trade, syncId: identity })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'investment_trade',
      entitySyncId: identity,
      operation: 'upsert',
    });
    const transaction = insertTransaction(tx, { ...cash, investmentTradeId: row.id });
    return { trade: row, transaction };
  });
}

/** Rewrites a trade and its cash transaction together, or neither. */
export function updateTradeWithCash(
  id: number,
  trade: UpdateTradeRecord,
  cash: UpdateTransactionRecord,
): InvestmentTrade | null {
  return db.transaction((tx) => {
    const row =
      tx
        .update(investmentTrades)
        .set(trade)
        .where(and(liveTrade, eq(investmentTrades.id, id)))
        .returning()
        .get() ?? null;
    if (row === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'investment_trade',
      entitySyncId: requireSyncId(row.syncId, 'investment trade'),
      operation: 'upsert',
    });
    const linked = getLinkedTransaction(id, tx);
    if (linked === null || linked.deletedAt !== null) {
      // Rolls the trade back too: a trade whose cash cannot be found is exactly
      // the mismatch this transaction exists to prevent.
      throw new Error(`Investment trade ${id} has no live cash transaction.`);
    }
    updateTransactionWithin(tx, linked.id, cash);
    return row;
  });
}

/** Tombstones a trade and its cash transaction together. */
export function deleteTradeWithCash(id: number, deletedAt: Date): InvestmentTrade | null {
  return db.transaction((tx) => {
    const row =
      tx
        .update(investmentTrades)
        .set({ deletedAt })
        .where(and(liveTrade, eq(investmentTrades.id, id)))
        .returning()
        .get() ?? null;
    if (row === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'investment_trade',
      entitySyncId: requireSyncId(row.syncId, 'investment trade'),
      operation: 'delete',
    });
    const linked = getLinkedTransaction(id, tx);
    if (linked !== null && linked.deletedAt === null) {
      deleteTransactionWithin(tx, linked.id, deletedAt);
    }
    return row;
  });
}

/** The built-in Investment Return income category a dividend is recorded in. */
export function getCategoryBySystemKey(systemKey: string) {
  return (
    db
      .select()
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.systemKey, systemKey)))
      .get() ?? null
  );
}

// Prices

export function insertPrice(data: CreatePriceRecord): InvestmentPrice {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const price = tx
      .insert(investmentPrices)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'investment_price',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return price;
  });
}

export function updatePrice(id: number, data: UpdatePriceRecord): InvestmentPrice | null {
  return db.transaction((tx) => {
    const price =
      tx
        .update(investmentPrices)
        .set(data)
        .where(and(livePrice, eq(investmentPrices.id, id)))
        .returning()
        .get() ?? null;
    if (price === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'investment_price',
      entitySyncId: requireSyncId(price.syncId, 'investment price'),
      operation: 'upsert',
    });
    return price;
  });
}

export function deletePrice(id: number, deletedAt: Date): InvestmentPrice | null {
  return db.transaction((tx) => {
    const price =
      tx
        .update(investmentPrices)
        .set({ deletedAt })
        .where(and(livePrice, eq(investmentPrices.id, id)))
        .returning()
        .get() ?? null;
    if (price === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'investment_price',
      entitySyncId: requireSyncId(price.syncId, 'investment price'),
      operation: 'delete',
    });
    return price;
  });
}

export function getPriceById(id: number): InvestmentPrice | null {
  return (
    db
      .select()
      .from(investmentPrices)
      .where(and(livePrice, eq(investmentPrices.id, id)))
      .get() ?? null
  );
}

/** Newest first: by date, then by when it was entered, then by identity. */
const priceOrder = [
  desc(investmentPrices.priceDate),
  desc(investmentPrices.createdAt),
  desc(investmentPrices.syncId),
] as const;

export function listPricesForAsset(assetId: number): InvestmentPrice[] {
  return db
    .select()
    .from(investmentPrices)
    .where(and(livePrice, eq(investmentPrices.assetId, assetId)))
    .orderBy(...priceOrder)
    .all();
}

/** The price a valuation uses: the latest on or before `onOrBefore`. */
export function getLatestPrice(assetId: number, onOrBefore: string): InvestmentPrice | null {
  return (
    db
      .select()
      .from(investmentPrices)
      .where(
        and(
          livePrice,
          eq(investmentPrices.assetId, assetId),
          lte(investmentPrices.priceDate, onOrBefore),
        ),
      )
      .orderBy(...priceOrder)
      .limit(1)
      .get() ?? null
  );
}

/** The same for every asset at once, from one query. */
export function listLatestPrices(onOrBefore: string): Map<number, InvestmentPrice> {
  const latest = new Map<number, InvestmentPrice>();
  const rows = db
    .select()
    .from(investmentPrices)
    .where(and(livePrice, lte(investmentPrices.priceDate, onOrBefore)))
    .orderBy(asc(investmentPrices.assetId), ...priceOrder)
    .all();
  for (const row of rows) {
    if (!latest.has(row.assetId)) latest.set(row.assetId, row);
  }
  return latest;
}
