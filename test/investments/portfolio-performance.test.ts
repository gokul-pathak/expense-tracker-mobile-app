import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';

import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * A large portfolio: 100 assets, 5,000 trades and 1,000 prices.
 *
 * The summary is three queries — assets, every live trade in replay order, the
 * latest price per asset — and one replay per asset in memory, however long the
 * history. Recording one more trade replays one asset, never the portfolio. The
 * time budgets are generous on purpose: they catch a per-trade query or a
 * quadratic replay, not a slow CI machine.
 */

const ASSETS = 100;
const TRADES_PER_ASSET = 50;
const PRICES_PER_ASSET = 10;
const UNIT = 100_000_000;

describe('a large portfolio', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('is summarized from bounded reads, and one new trade replays one asset', () => {
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
    for (let a = 0; a < ASSETS; a += 1) {
      const assetId = Number(insertAsset.run(`Asset ${a}`, randomUUID()).lastInsertRowid);
      assetIds.push(assetId);
      for (let t = 0; t < TRADES_PER_ASSET; t += 1) {
        // Buy 2, sell 1, alternately: the holding never goes negative.
        const buying = t % 2 === 0;
        const day = new Date(2026, 0, 1 + t).getTime();
        insertTrade.run(
          assetId,
          bank.id,
          buying ? 'buy' : 'sell',
          day,
          (buying ? 2 : 1) * UNIT,
          100_000 + t * 100,
          buying ? 1_000 : 500,
          day,
          day,
          randomUUID(),
        );
      }
      for (let p = 0; p < PRICES_PER_ASSET; p += 1) {
        insertPrice.run(
          assetId,
          110_000 + p * 500,
          `2026-03-${String(p + 1).padStart(2, '0')}`,
          randomUUID(),
        );
      }
    }
    client.exec('COMMIT');

    const started = performance.now();
    const summary = portfolio.getPortfolioSummary({ asOf: new Date(2026, 5, 1) });
    const summaryMs = performance.now() - started;

    expect(summary.invalidAssetIds).toEqual([]);
    expect(summary.currencies).toHaveLength(1);
    expect(summary.currencies[0]).toMatchObject({
      currency: 'NPR',
      assetCount: ASSETS,
      openPositionCount: ASSETS,
      pricedPositionCount: ASSETS,
      unpricedPositionCount: 0,
    });
    // 25 buys of 2 less 25 sells of 1, per asset, at the 10 March price.
    const first = portfolio.getHolding(assetIds[0]!, { asOf: new Date(2026, 5, 1) });
    expect(first.quantityMinor).toBe(25 * UNIT);
    expect(first.latestPrice?.priceDate).toBe('2026-03-10');
    expect(summaryMs).toBeLessThan(5_000);

    const tradeStarted = performance.now();
    investments.sellAsset({
      assetId: assetIds[0]!,
      accountId: bank.id,
      quantityMinor: parseQuantity('1'),
      unitPriceMinor: 120_000,
      tradeDate: new Date(2026, 5, 1),
    });
    const tradeMs = performance.now() - tradeStarted;
    expect(tradeMs).toBeLessThan(2_000);
    expect(portfolio.getHolding(assetIds[0]!).quantityMinor).toBe(24 * UNIT);
  });
});
