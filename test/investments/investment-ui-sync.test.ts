import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as present from '@/features/investments/investment-presentation';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import {
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice, makeAccount } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

/**
 * The investment screens across devices, a restore, and a sync that needs attention.
 *
 * What is compared is what a person would see — every sentence and figure the
 * portfolio and asset screens render — keyed by names rather than local row ids,
 * which differ between devices by design.
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

/** This device's copy of the shared asset and account. */
function local() {
  const asset = investments.listAssets().find((item) => item.name === 'ABC Shares');
  const bank = accountService.listAccounts().find((item) => item.name === 'Bank');
  if (asset === undefined || bank === undefined) throw new Error('This device lacks the fixture.');
  return { assetId: asset.id, bankId: bank.id };
}

function trade(kind: 'buy' | 'sell', quantity: string, day: number, price = 1_200) {
  const { assetId, bankId } = local();
  const input = {
    assetId,
    accountId: bankId,
    quantityMinor: shares(quantity),
    unitPriceMinor: rupees(price),
    tradeDate: september(day),
  };
  return kind === 'buy' ? investments.buyAsset(input) : investments.sellAsset(input);
}

/** The portfolio screen as it reads: every row's words and the per-currency figures. */
function portfolioAsShown() {
  const { holdings, summary } = portfolio.getPortfolioOverview(AS_OF);
  const lists = present.partitionHoldings(holdings);
  const row = (holding: (typeof holdings)[number]) => ({
    label: present.holdingAccessibilityLabel(holding),
    detail: present.holdingDetailLine(holding),
    costBasisMinor: holding.costBasisMinor,
    realizedGainMinor: holding.realizedGainMinor,
  });
  return {
    holdings: lists.holdings.map(row),
    closed: lists.closed.map(row),
    archived: lists.archived.map(row),
    currencies: summary.currencies,
  };
}

/** The asset screen as it reads, without local row ids. */
function assetAsShown() {
  const detail = portfolio.getAssetDetail(local().assetId, AS_OF);
  const { assetId: _assetId, ...holding } = detail.holding;
  return {
    holding,
    history: detail.history.map((entry) => ({
      type: entry.tradeType,
      date: entry.tradeDate.getTime(),
      quantityMinor: entry.quantityMinor,
      cash: entry.cashEffect,
      account: entry.accountName,
      syncId: entry.syncId,
    })),
    prices: detail.recentPrices.map((price) => [price.priceDate, price.priceMinor]),
  };
}

describe('investment screens across devices', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    makeAccount('Bank', 'NPR', rupees(100_000));
    const asset = investments.createAsset({
      name: 'ABC Shares',
      assetType: 'stock',
      currency: 'NPR',
    });
    trade('buy', '10', 1, 1_000);
    investments.addPrice({ assetId: asset.id, priceMinor: rupees(1_200), priceDate: '2026-09-10' });
    await push();
    await setupDevice(B);
    await linkUsingCloudData(reconcile());
    onDevice(A);
  });
  afterAll(() => closeTestDatabase());

  it('restores the same portfolio on a new device, figure for figure', () => {
    const onA = { portfolio: portfolioAsShown(), asset: assetAsShown() };
    onDevice(B);
    expect({ portfolio: portfolioAsShown(), asset: assetAsShown() }).toEqual(onA);
    expect(onA.portfolio.currencies[0]?.marketValueMinor).toBe(rupees(12_000));
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('shows a buy from another device once a pull applies it, with no restart', async () => {
    trade('buy', '5', 3, 1_100);
    expect((await push()).status).toBe('success');

    onDevice(B);
    const before = portfolioAsShown();
    const pulled = await pull();
    // Applying anything is what tells the open screens to read SQLite again.
    expect(pulled.applied).toBeGreaterThan(0);
    const after = portfolioAsShown();
    expect(after).not.toEqual(before);
    expect(assetAsShown().holding.quantityMinor).toBe(shares('15'));

    onDevice(A);
    const onA = { portfolio: portfolioAsShown(), asset: assetAsShown() };
    onDevice(B);
    expect({ portfolio: portfolioAsShown(), asset: assetAsShown() }).toEqual(onA);
  });

  it('values the holding on the other device from a manual price entered here', async () => {
    investments.addPrice({
      assetId: local().assetId,
      priceMinor: rupees(1_300),
      priceDate: '2026-09-20',
    });
    await push();

    onDevice(B);
    const balance = getAccountBalance(local().bankId);
    await pull();
    expect(assetAsShown().holding).toMatchObject({
      marketValueMinor: rupees(13_000),
      unrealizedGainMinor: rupees(3_000),
    });
    // A price moves no money on any device.
    expect(getAccountBalance(local().bankId)).toBe(balance);
    const onB = assetAsShown();
    onDevice(A);
    expect(assetAsShown()).toEqual(onB);
  });

  it('shows an offline buy at once, then uploads it exactly once', async () => {
    onDevice(B);
    const pending = countPendingSyncMutations();
    trade('buy', '3', 4, 1_050);
    expect(assetAsShown().holding.quantityMinor).toBe(shares('13'));
    expect(countPendingSyncMutations()).toBe(pending + 2);

    expect((await push()).status).toBe('success');
    expect(countPendingSyncMutations()).toBe(0);
    const uploaded = cloud.rows('investment_trade').length;
    await push();
    expect(cloud.rows('investment_trade')).toHaveLength(uploaded);

    onDevice(A);
    await pull();
    const onA = assetAsShown();
    expect(onA.holding.quantityMinor).toBe(shares('13'));
    expect(onA.history).toHaveLength(2);
    onDevice(B);
    expect(assetAsShown()).toEqual(onA);
  });

  it('never shows a negative holding while two devices’ sales of the same units need attention', async () => {
    trade('sell', '7', 10);
    onDevice(B);
    trade('sell', '7', 12, 1_250);
    onDevice(A);
    await push();

    onDevice(B);
    expect((await pull()).status).toBe('attention_required');
    const shown = assetAsShown();
    expect(shown.holding.status).not.toBe('invalid');
    expect(shown.holding.quantityMinor).toBe(shares('3'));
    for (const row of portfolioAsShown().holdings) {
      expect(row.label).not.toMatch(/−\d|-\d/);
    }
    expect(present.SYNC_ATTENTION_NOTE).toMatch(/^Sync needs attention\./);
  });

  it('shows the same portfolio after a backup is restored, with nothing to rebuild', async () => {
    trade('sell', '4', 15);
    investments.recordDividend({
      assetId: local().assetId,
      accountId: local().bankId,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });
    const shown = { portfolio: portfolioAsShown(), asset: assetAsShown() };
    const backup = createBackup();

    await setupDatabase();
    restoreBackup(backup);

    expect({ portfolio: portfolioAsShown(), asset: assetAsShown() }).toEqual(shown);
    expect(shown.asset.holding).toMatchObject({
      quantityMinor: shares('6'),
      realizedGainMinor: rupees(4_800 - 4_000),
      dividendsMinor: rupees(500),
    });
  });
});
