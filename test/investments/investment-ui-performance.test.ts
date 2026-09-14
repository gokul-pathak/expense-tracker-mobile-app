import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { parseQuantity } from '@/features/investments/investment-math';
import * as present from '@/features/investments/investment-presentation';
import * as portfolio from '@/features/investments/portfolio.service';
import * as preview from '@/features/investments/trade-preview.service';

import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * The investment screens over a large portfolio: 100 assets, 5,000 trades, 1,000
 * prices — and one asset whose history alone is 5,000 trades.
 *
 * The property that matters is the number of queries, not the milliseconds: a
 * screen that asks SQLite once per trade is fine at ten trades and unusable at ten
 * thousand. Every read goes through `DatabaseSync.prepare`, so counting those calls
 * counts the queries. The time budgets are generous on purpose; they catch a
 * quadratic replay, not a slow machine.
 */

const UNIT = 100_000_000;
const AS_OF = { asOf: new Date(2027, 0, 1) };

function seed(assets: number, tradesPerAsset: number, pricesPerAsset: number) {
  const bank = makeAccount('Bank', 'NPR', 0);
  const client = rawClient();
  const insertAsset = client.prepare(
    `INSERT INTO investment_assets (name, asset_type, currency, is_archived, created_at, updated_at, sync_id)
     VALUES (?, 'stock', 'NPR', 0, 1, 1, ?)`,
  );
  const insertTrade = client.prepare(
    `INSERT INTO investment_trades (asset_id, account_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at, sync_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'NPR', ?, ?, ?)`,
  );
  const insertPrice = client.prepare(
    `INSERT INTO investment_prices (asset_id, price_minor, price_date, currency, created_at, updated_at, sync_id)
     VALUES (?, ?, ?, 'NPR', 1, 1, ?)`,
  );
  const assetIds: number[] = [];
  client.exec('BEGIN');
  for (let a = 0; a < assets; a += 1) {
    const assetId = Number(insertAsset.run(`Asset ${a}`, randomUUID()).lastInsertRowid);
    assetIds.push(assetId);
    for (let t = 0; t < tradesPerAsset; t += 1) {
      // Buy 2, sell 1, alternately: the holding never goes negative.
      const buying = t % 2 === 0;
      const day = Date.UTC(2020, 0, 1) + t * 3_600_000;
      insertTrade.run(
        assetId,
        bank.id,
        buying ? 'buy' : 'sell',
        day,
        (buying ? 2 : 1) * UNIT,
        100_000 + (t % 50) * 100,
        buying ? 1_000 : 500,
        day,
        day,
        randomUUID(),
      );
    }
    for (let p = 0; p < pricesPerAsset; p += 1) {
      insertPrice.run(
        assetId,
        110_000 + p * 500,
        `2026-03-${String(p + 1).padStart(2, '0')}`,
        randomUUID(),
      );
    }
  }
  client.exec('COMMIT');
  return { bankId: bank.id, assetIds };
}

describe('investment screens over a large portfolio', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('reads the portfolio screen in three queries and one replay, however many trades there are', () => {
    seed(100, 50, 10);
    const prepare = vi.spyOn(rawClient(), 'prepare');

    const started = performance.now();
    const overview = portfolio.getPortfolioOverview(AS_OF);
    const lists = present.partitionHoldings(overview.holdings);
    const labels = lists.holdings.map((holding) => present.holdingAccessibilityLabel(holding));
    const elapsed = performance.now() - started;

    // Assets, every live trade in replay order, the latest price per asset.
    expect(prepare).toHaveBeenCalledTimes(3);
    prepare.mockRestore();
    expect(lists.holdings).toHaveLength(100);
    expect(labels.every((label) => label.includes('25 shares held'))).toBe(true);
    expect(overview.summary.currencies[0]).toMatchObject({
      assetCount: 100,
      pricedPositionCount: 100,
    });
    expect(overview.summary).toEqual(portfolio.getPortfolioSummary(AS_OF));
    expect(elapsed).toBeLessThan(5_000);
  });

  it('opens an asset with 5,000 trades, and previews a sale on it, from a handful of queries', () => {
    const { assetIds } = seed(1, 5_000, 10);
    const [assetId] = assetIds;
    const prepare = vi.spyOn(rawClient(), 'prepare');

    let started = performance.now();
    const detail = portfolio.getAssetDetail(assetId!, AS_OF);
    const detailMs = performance.now() - started;
    // The asset, its trades, its prices, its latest price, and each distinct account.
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(5);
    expect(detail.history).toHaveLength(5_000);
    expect(detail.recentPrices).toHaveLength(5);
    expect(detail.holding.quantityMinor).toBe(2_500 * UNIT);
    expect(detailMs).toBeLessThan(5_000);

    prepare.mockClear();
    started = performance.now();
    const available = preview.getSellableQuantity(assetId!, new Date(2026, 8, 1));
    const sale = preview.previewSell({
      assetId: assetId!,
      quantityMinor: parseQuantity('10'),
      unitPriceMinor: 120_000,
      tradeDate: new Date(2026, 8, 1),
    });
    const previewMs = performance.now() - started;
    // Each is the asset and its trades: two queries, never one per trade.
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(4);
    prepare.mockRestore();
    expect(available).toBe(2_500 * UNIT);
    expect(sale.remainingQuantityMinor).toBe(2_490 * UNIT);
    expect(previewMs).toBeLessThan(3_000);
  });
});
