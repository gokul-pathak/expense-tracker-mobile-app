import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import { parseQuantity } from '@/features/investments/investment-math';
import { replayTrades } from '@/features/investments/investment-replay';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import { readLocalDataInventory } from '@/features/sync/data-inventory';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import {
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import {
  cloudAccount,
  cloudInvestmentAsset,
  cloudInvestmentTrade,
  cloudTransaction,
  TEST_USER,
} from '../support/cloud-rows';
import { makeAccount, onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * Investments across devices.
 *
 * The release-critical property: two phones hold the same 10 shares, and while
 * offline each sells 7. Each sale is valid on its own phone. Together they sell
 * 14, and no device — and not the cloud — may ever end up holding that history as
 * though it had happened.
 *
 * Every test runs genuinely separate SQLite databases against one in-memory cloud
 * that reproduces the real one's holdings guard.
 */

const A = 'default';
const B = 'B';
const AS_OF = { asOf: new Date(2026, 8, 30, 12) };

const rupees = (amount: number) => Math.round(amount * 100);
const shares = (text: string) => parseQuantity(text);
const september = (day: number) => new Date(2026, 8, day);

let cloud: FakeCloud;

function push() {
  return pushPendingChanges({
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
    },
  });
}

function pull() {
  return pullRemoteChanges({
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.pullRepository,
    },
  });
}

function reconcile(): ReconciliationOptions {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason) => ({
        reason,
        location: `memory://${reason}`,
        createdAt: new Date(),
      }),
      reseedDefaults: async () => false,
    },
  };
}

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

/** This device's copy of an asset, found by the identity every device shares. */
function localAsset(syncId: string) {
  const asset = investments.listAssets().find((item) => item.syncId === syncId);
  if (asset === undefined) throw new Error('This device does not have that asset.');
  return asset;
}

function localAccount(syncId: string) {
  const account = accountService.listAccounts().find((item) => item.syncId === syncId);
  if (account === undefined) throw new Error('This device does not have that account.');
  return account;
}

function localTrade(syncId: string) {
  return rawClient()
    .prepare(
      'SELECT id, quantity_minor, fee_minor, deleted_at FROM investment_trades WHERE sync_id = ?',
    )
    .get(syncId) as
    | { id: number; quantity_minor: number | null; fee_minor: number; deleted_at: number | null }
    | undefined;
}

/** What a device's figures say, keyed by shared identities rather than local row ids. */
function figures(assetSyncId: string, accountSyncId: string) {
  const holding = portfolio.getHolding(localAsset(assetSyncId).id, AS_OF);
  return {
    status: holding.status,
    quantityMinor: holding.quantityMinor,
    costBasisMinor: holding.costBasisMinor,
    realizedGainMinor: holding.realizedGainMinor,
    dividendsMinor: holding.dividendsMinor,
    balance: getAccountBalance(localAccount(accountSyncId).id),
  };
}

/** Whether the cloud's live trades for an asset are a history that could have happened. */
function cloudHistoryValid(assetSyncId: string): boolean {
  const trades = cloud
    .rows('investment_trade')
    .map((row) => row as unknown as Record<string, unknown>)
    .filter((row) => row.asset_sync_id === assetSyncId && row.deleted_at === null)
    .map((row) => ({
      syncId: String(row.sync_id),
      tradeType: row.trade_type as 'buy' | 'sell' | 'dividend' | 'fee',
      tradeDate: Number(row.trade_date),
      createdAt: Number(row.created_at),
      quantityMinor: row.quantity_minor === null ? null : Number(row.quantity_minor),
      unitPriceMinor: row.unit_price_minor === null ? null : Number(row.unit_price_minor),
      feeMinor: Number(row.fee_minor),
      amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    }));
  return replayTrades(trades).ok;
}

type Shared = { assetSyncId: string; accountSyncId: string; buySyncId: string };

/** Bank at 100,000 with 10 ABC Shares bought at 1,000 plus a fee of 100. */
function recordTheFixture(): Shared {
  const bank = makeAccount('Bank', 'NPR', rupees(100_000));
  const asset = investments.createAsset({
    name: 'ABC Shares',
    assetType: 'stock',
    currency: 'NPR',
  });
  const buy = investments.buyAsset({
    assetId: asset.id,
    accountId: bank.id,
    quantityMinor: shares('10'),
    unitPriceMinor: rupees(1_000),
    feeMinor: rupees(100),
    tradeDate: september(1),
  });
  return { assetSyncId: asset.syncId!, accountSyncId: bank.syncId!, buySyncId: buy.syncId! };
}

function sell(shared: Shared, quantity: string, day: number, price = 1_200) {
  return investments.sellAsset({
    assetId: localAsset(shared.assetSyncId).id,
    accountId: localAccount(shared.accountSyncId).id,
    quantityMinor: shares(quantity),
    unitPriceMinor: rupees(price),
    tradeDate: september(day),
  });
}

describe('investment upload', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
  });
  afterAll(() => closeTestDatabase());

  it('uploads the asset, trades, prices and their cash once, and nothing derived', async () => {
    const shared = recordTheFixture();
    const asset = localAsset(shared.assetSyncId);
    const bank = localAccount(shared.accountSyncId);
    investments.addPrice({ assetId: asset.id, priceMinor: rupees(1_200), priceDate: '2026-09-10' });
    const sale = sell(shared, '4', 15);
    investments.recordDividend({
      assetId: asset.id,
      accountId: bank.id,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });

    const result = await push();

    expect(result.status).toBe('success');
    expect(countPendingSyncMutations()).toBe(0);
    expect(cloud.rows('investment_asset')).toHaveLength(1);
    expect(cloud.rows('investment_price')).toHaveLength(1);
    expect(cloud.rows('investment_trade')).toHaveLength(3);
    const cash = cloud
      .rows('transaction')
      .map((row) => row as unknown as Record<string, unknown>)
      .filter((row) => row.investment_trade_sync_id !== null);
    expect(cash.map((row) => row.type).sort()).toEqual([
      'income',
      'investment',
      'investment_return',
    ]);
    expect(cash.find((row) => row.investment_trade_sync_id === sale.syncId)).toMatchObject({
      amount_minor: rupees(4_800),
      destination_account_sync_id: shared.accountSyncId,
    });

    // Source fields only: no holding, cost basis, gain or value ever travels.
    const trade = cloud.rowBySyncId('investment_trade', sale.syncId!) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(trade).sort()).toEqual(
      [
        'account_sync_id',
        'amount_minor',
        'asset_sync_id',
        'created_at',
        'currency',
        'deleted_at',
        'fee_minor',
        'note',
        'quantity_minor',
        'sync_id',
        'trade_date',
        'trade_type',
        'unit_price_minor',
        'updated_at',
        'user_id',
      ].sort(),
    );
    expect(cloudHistoryValid(shared.assetSyncId)).toBe(true);
  });

  it('uploads the asset before its trades, and a trade before the cash that names it', async () => {
    recordTheFixture();
    await push();

    const order = cloud.calls.map((call) => call.entityType);
    expect(order.indexOf('investment_asset')).toBeLessThan(order.indexOf('investment_trade'));
    expect(order.indexOf('investment_trade')).toBeLessThan(order.lastIndexOf('transaction'));
  });

  it('keeps a sale queued when the cloud refuses it as an oversell', async () => {
    const shared = recordTheFixture();
    await push();
    // Another device already published a sale of 7 that this one has not pulled.
    cloud.putRow(
      'investment_trade',
      cloudInvestmentTrade({
        asset_sync_id: shared.assetSyncId,
        account_sync_id: shared.accountSyncId,
        trade_type: 'sell',
        quantity_minor: shares('7'),
        trade_date: september(5).getTime(),
      }),
    );
    const sale = sell(shared, '7', 6);

    const result = await push();

    expect(result.failures[0]).toMatchObject({
      entityType: 'investment_trade',
      entitySyncId: sale.syncId,
      code: 'constraint',
    });
    expect(cloud.rowBySyncId('investment_trade', sale.syncId!)).toBeUndefined();
    expect(cloudHistoryValid(shared.assetSyncId)).toBe(true);
    // Nothing was dropped: the sale and its cash are still waiting.
    expect(countPendingSyncMutations()).toBeGreaterThanOrEqual(2);
    expect(localTrade(sale.syncId!)?.deleted_at).toBeNull();
  });

  it('counts an asset alone as data worth protecting', async () => {
    await setupDatabase();
    investments.createAsset({ name: 'Fund', assetType: 'mutual_fund', currency: 'NPR' });
    const inventory = readLocalDataInventory();
    expect(inventory.investmentAssets).toBe(1);
    expect(inventory.hasMeaningfulData).toBe(true);
  });
});

describe('downloaded investments', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
  });

  it('refuses a trade whose account holds another currency', async () => {
    const account = cloudAccount({ currency: 'USD' });
    const asset = cloudInvestmentAsset({ currency: 'NPR' });
    cloud.putRow('account', account);
    cloud.putRow('investment_asset', asset);
    cloud.putRow(
      'investment_trade',
      cloudInvestmentTrade({ asset_sync_id: asset.sync_id, account_sync_id: account.sync_id }),
    );

    const result = await pull();

    expect(result.failures[0]).toMatchObject({
      entityType: 'investment_trade',
      code: 'invalid_remote_data',
      detail: 'account_currency',
    });
    expect(count('investment_trades')).toBe(0);
  });

  it('waits for an asset that has not arrived, rather than writing a trade without one', async () => {
    const account = cloudAccount();
    cloud.putRow('account', account);
    cloud.putRow(
      'investment_trade',
      cloudInvestmentTrade({
        asset_sync_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        account_sync_id: account.sync_id,
      }),
    );

    const result = await pull();

    expect(result.failures[0]).toMatchObject({
      code: 'unknown_parent',
      detail: 'investment_asset',
    });
    expect(count('investment_trades')).toBe(0);
  });

  it('refuses a history that sells more than it holds, even from the cloud', async () => {
    const account = cloudAccount();
    const asset = cloudInvestmentAsset();
    cloud.putRow('account', account);
    cloud.putRow('investment_asset', asset);
    cloud.putRow(
      'investment_trade',
      cloudInvestmentTrade({
        asset_sync_id: asset.sync_id,
        account_sync_id: account.sync_id,
        trade_type: 'sell',
        quantity_minor: shares('1'),
      }),
    );

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({
      code: 'domain_invariant',
      detail: 'investment_oversold',
    });
    expect(count('investment_trades')).toBe(0);
  });

  it('refuses investment cash for a trade the device does not have', async () => {
    const account = cloudAccount();
    cloud.putRow('account', account);
    cloud.putRow(
      'transaction',
      cloudTransaction({
        type: 'investment',
        source_account_sync_id: account.sync_id,
        investment_trade_sync_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    );

    const result = await pull();

    expect(result.failures[0]).toMatchObject({
      code: 'unknown_parent',
      detail: 'investment_trade',
    });
  });
});

describe('two devices', () => {
  let shared: Shared;

  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    shared = recordTheFixture();
    await push();
    await setupDevice(B);
    await linkUsingCloudData(reconcile());
    onDevice(A);
  });

  it('restores investments on a new device with identical figures, and queues nothing', () => {
    const onA = figures(shared.assetSyncId, shared.accountSyncId);
    onDevice(B);
    expect(figures(shared.assetSyncId, shared.accountSyncId)).toEqual(onA);
    expect(onA).toMatchObject({
      quantityMinor: shares('10'),
      costBasisMinor: rupees(10_100),
      balance: rupees(89_900),
    });
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('keeps both of two offline buys', async () => {
    const assetA = localAsset(shared.assetSyncId);
    investments.buyAsset({
      assetId: assetA.id,
      accountId: localAccount(shared.accountSyncId).id,
      quantityMinor: shares('5'),
      unitPriceMinor: rupees(1_100),
      tradeDate: september(3),
    });
    onDevice(B);
    investments.buyAsset({
      assetId: localAsset(shared.assetSyncId).id,
      accountId: localAccount(shared.accountSyncId).id,
      quantityMinor: shares('3'),
      unitPriceMinor: rupees(1_050),
      tradeDate: september(4),
    });

    onDevice(A);
    expect((await push()).status).toBe('success');
    onDevice(B);
    await pull();
    expect((await push()).status).toBe('success');
    onDevice(A);
    await pull();

    const onA = figures(shared.assetSyncId, shared.accountSyncId);
    onDevice(B);
    expect(figures(shared.assetSyncId, shared.accountSyncId)).toEqual(onA);
    expect(onA.quantityMinor).toBe(shares('18'));
    // 10,100 + 5,500 + 3,150.
    expect(onA.costBasisMinor).toBe(rupees(18_750));
    expect(count('investment_trades', 'deleted_at IS NULL')).toBe(3);
    // A remote apply never queues work.
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('never applies the second of two offline sales of the same units, anywhere', async () => {
    const saleA = sell(shared, '7', 10);
    onDevice(B);
    const saleB = sell(shared, '7', 12, 1_250);

    onDevice(A);
    expect((await push()).status).toBe('success');

    onDevice(B);
    const pulled = await pull();
    expect(pulled.status).toBe('attention_required');
    expect(pulled.failures[0]).toMatchObject({
      entityType: 'investment_trade',
      code: 'domain_invariant',
      detail: 'investment_oversold',
    });
    // B keeps its own sale and never holds the other: 3 units, never -4.
    expect(portfolio.getHolding(localAsset(shared.assetSyncId).id, AS_OF).quantityMinor).toBe(
      shares('3'),
    );
    expect(localTrade(saleA.syncId!)).toBeUndefined();

    // B's upload is refused by the cloud's guard for the same reason.
    const pushed = await push();
    expect(pushed.failures).toContainEqual(
      expect.objectContaining({ entityType: 'investment_trade', code: 'constraint' }),
    );
    expect(cloud.rowBySyncId('investment_trade', saleB.syncId!)).toBeUndefined();
    expect(cloudHistoryValid(shared.assetSyncId)).toBe(true);

    // A person resolves it on B, and everything converges.
    investments.deleteTrade(saleB.id);
    expect((await pull()).status).not.toBe('attention_required');
    await push();
    onDevice(A);
    await pull();

    const onA = figures(shared.assetSyncId, shared.accountSyncId);
    onDevice(B);
    expect(figures(shared.assetSyncId, shared.accountSyncId)).toEqual(onA);
    expect(onA).toMatchObject({ quantityMinor: shares('3'), balance: rupees(89_900 + 8_400) });
    expect(cloudHistoryValid(shared.assetSyncId)).toBe(true);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('refuses the conflicting sale whichever of the two sorts first in time', async () => {
    sell(shared, '7', 15);
    onDevice(B);
    // B's own sale is earlier, so it is the other device's that no longer fits.
    sell(shared, '7', 5);

    onDevice(A);
    await push();
    onDevice(B);
    const pulled = await pull();

    expect(pulled.failures[0]).toMatchObject({ code: 'domain_invariant' });
    const holding = portfolio.getHolding(localAsset(shared.assetSyncId).id, AS_OF);
    expect(holding.status).not.toBe('invalid');
    expect(holding.quantityMinor).toBe(shares('3'));
  });

  it('deletes a trade and its cash together on the other device', async () => {
    const dividend = investments.recordDividend({
      assetId: localAsset(shared.assetSyncId).id,
      accountId: localAccount(shared.accountSyncId).id,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });
    await push();
    onDevice(B);
    await pull();
    expect(figures(shared.assetSyncId, shared.accountSyncId).dividendsMinor).toBe(rupees(500));

    onDevice(A);
    investments.deleteTrade(dividend.id);
    await push();
    onDevice(B);
    await pull();

    expect(localTrade(dividend.syncId!)?.deleted_at).not.toBeNull();
    const cash = rawClient()
      .prepare(
        `SELECT deleted_at FROM transactions WHERE investment_trade_id = (SELECT id FROM investment_trades WHERE sync_id = ?)`,
      )
      .get(dividend.syncId) as { deleted_at: number | null };
    expect(cash.deleted_at).not.toBeNull();
    const onB = figures(shared.assetSyncId, shared.accountSyncId);
    onDevice(A);
    expect(figures(shared.assetSyncId, shared.accountSyncId)).toEqual(onB);
    expect(onB.dividendsMinor).toBe(0);
  });

  it('converges when both devices edit the same trade, and stays a valid history', async () => {
    const buyA = localTrade(shared.buySyncId)!;
    investments.updateTrade(buyA.id, { feeMinor: rupees(150) });
    onDevice(B);
    investments.updateTrade(localTrade(shared.buySyncId)!.id, { quantityMinor: shares('12') });

    onDevice(A);
    await push();
    onDevice(B);
    await pull();
    await push();
    onDevice(A);
    await pull();

    const onA = figures(shared.assetSyncId, shared.accountSyncId);
    onDevice(B);
    expect(figures(shared.assetSyncId, shared.accountSyncId)).toEqual(onA);
    expect(onA.status).not.toBe('invalid');
    expect(localTrade(shared.buySyncId)).toMatchObject({ quantity_minor: shares('12') });
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('replaces the cloud with this device’s investments when told to, retiring sales first', async () => {
    // The cloud also holds a sale this device will not keep.
    sell(shared, '7', 10);
    await push();

    // A third device with its own, different portfolio takes over the account.
    await setupDevice('C');
    const bank = makeAccount('Savings', 'NPR', rupees(50_000));
    const fund = investments.createAsset({ name: 'C Fund', assetType: 'etf', currency: 'NPR' });
    investments.buyAsset({
      assetId: fund.id,
      accountId: bank.id,
      quantityMinor: shares('2.5'),
      unitPriceMinor: rupees(2_000),
      tradeDate: september(2),
    });
    await linkUsingLocalData(reconcile());

    const live = (entityType: 'investment_asset' | 'investment_trade') =>
      cloud
        .rows(entityType)
        .map((row) => row as unknown as Record<string, unknown>)
        .filter((row) => row.deleted_at === null);
    expect(live('investment_asset').map((row) => row.sync_id)).toEqual([fund.syncId]);
    expect(live('investment_trade')).toHaveLength(1);
    expect(cloudHistoryValid(shared.assetSyncId)).toBe(true);
    expect(cloudHistoryValid(fund.syncId!)).toBe(true);
  });
});

describe('integrity', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
  });

  it('reports a trade whose cash no longer matches it, and repairs nothing', () => {
    const shared = recordTheFixture();
    expect(verifySyncIntegrity().issues).toEqual([]);
    const tradeId = localTrade(shared.buySyncId)!.id;
    rawClient()
      .prepare(
        'UPDATE transactions SET amount_minor = amount_minor + 1 WHERE investment_trade_id = ?',
      )
      .run(tradeId);

    const report = verifySyncIntegrity();

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'investment_cash_mismatch', count: 1 }),
    );
    // Reported, not rewritten.
    expect(
      (
        rawClient()
          .prepare('SELECT amount_minor FROM transactions WHERE investment_trade_id = ?')
          .get(tradeId) as { amount_minor: number }
      ).amount_minor,
    ).toBe(rupees(10_100) + 1);
  });

  it('reports a history that sells more than it holds', () => {
    const shared = recordTheFixture();
    const asset = localAsset(shared.assetSyncId);
    rawClient()
      .prepare(
        `INSERT INTO investment_trades (asset_id, account_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at, sync_id)
         VALUES (?, ?, 'sell', ?, ?, 100000, 0, 'NPR', ?, ?, '22222222-2222-4222-8222-222222222222')`,
      )
      .run(
        asset.id,
        localAccount(shared.accountSyncId).id,
        september(3).getTime(),
        shares('11'),
        Date.now(),
        Date.now(),
      );

    expect(verifySyncIntegrity().issues).toContainEqual(
      expect.objectContaining({ code: 'investment_negative_holding', count: 1 }),
    );
    expect(verifySyncIntegrity().issues).toContainEqual(
      expect.objectContaining({ code: 'investment_trade_without_cash', count: 1 }),
    );
  });
});
