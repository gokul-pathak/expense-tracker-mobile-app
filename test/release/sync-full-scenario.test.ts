import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as budgetService from '@/features/budgets/budget.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import * as recurring from '@/features/recurring/recurring.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import {
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import * as transactions from '@/features/transactions/transaction.service';

import { TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

import { buildEverything, logicalState, rupees, september } from './fixture';

/**
 * Cloud Sync across every domain at once: accounts, transactions of every type,
 * people, budgets, recurring schedules and investments, on two and three devices
 * against one in-memory cloud.
 */

const A = 'default';
const B = 'B';
const C = 'C';
const ENTITIES = [
  'settings',
  'account',
  'category',
  'person',
  'transaction',
  'budget',
  'recurring_template',
  'recurring_occurrence',
  'investment_asset',
  'investment_trade',
  'investment_price',
] as const;

let cloud: FakeCloud;
let shared: ReturnType<typeof buildEverything>;

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

/** What the foreground sync does: download, upload, then read back what was sent. */
async function cycle() {
  const downloaded = await pull();
  const uploaded = await push();
  const caughtUp = await pull();
  return { downloaded, uploaded, caughtUp };
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

/** This device's local id for a record every device knows by its global identity. */
function localId(table: string, syncId: string | null): number {
  const row = rawClient().prepare(`SELECT id FROM ${table} WHERE sync_id = ?`).get(syncId) as
    { id: number } | undefined;
  if (row === undefined) throw new Error(`This device has no ${table} ${syncId}.`);
  return row.id;
}

function isDeleted(table: string, syncId: string | null): boolean {
  const row = rawClient()
    .prepare(`SELECT deleted_at FROM ${table} WHERE sync_id = ?`)
    .get(syncId) as { deleted_at: number | null } | undefined;
  return row === undefined || row.deleted_at !== null;
}

function cloudShape() {
  return Object.fromEntries(
    ENTITIES.map((entity) => {
      const rows = cloud.rows(entity) as unknown as { sync_id: string }[];
      return [entity, { rows: rows.length, unique: new Set(rows.map((row) => row.sync_id)).size }];
    }),
  );
}

function conflicts(): number {
  const row = rawClient().prepare('SELECT count(*) AS total FROM sync_conflicts').get();
  return Number((row as { total: number }).total);
}

describe('Cloud Sync across every domain', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    shared = buildEverything();
    await push();
    await setupDevice(B);
    await linkUsingCloudData(reconcile());
    onDevice(A);
  });
  afterAll(() => closeTestDatabase());

  it('gives a second device every record and every derived figure of the first', () => {
    const onA = logicalState();
    onDevice(B);
    expect(logicalState()).toEqual(onA);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('reaches a fixed point: three more syncs on each device change nothing', async () => {
    onDevice(A);
    await cycle();
    onDevice(B);
    await cycle();
    const shape = cloudShape();
    const states = { A: logicalState(), B: logicalState() };
    onDevice(A);
    states.A = logicalState();
    const conflictCount = { A: conflicts(), B: 0 };
    onDevice(B);
    conflictCount.B = conflicts();

    for (let round = 0; round < 3; round += 1) {
      for (const device of [A, B] as const) {
        onDevice(device);
        const { downloaded, uploaded, caughtUp } = await cycle();
        expect(downloaded.applied + downloaded.deleted).toBe(0);
        expect(caughtUp.applied + caughtUp.deleted).toBe(0);
        expect(uploaded.succeeded ?? 0).toBe(0);
        expect(countPendingSyncMutations()).toBe(0);
        expect(conflicts()).toBe(device === A ? conflictCount.A : conflictCount.B);
        expect(logicalState()).toEqual(device === A ? states.A : states.B);
      }
      expect(cloudShape()).toEqual(shape);
    }
    for (const entity of ENTITIES) {
      expect(shape[entity]?.rows, entity).toBe(shape[entity]?.unique);
    }
    expect(states.B).toEqual(states.A);
  });

  it('converges after both devices change every domain offline', async () => {
    onDevice(B);
    transactions.createExpense({
      amountMinor: rupees(700),
      categoryId: localId('categories', shared.food.syncId),
      accountId: localId('accounts', shared.cash.syncId),
      transactionDate: september(21),
      title: 'Snacks',
    });
    budgetService.updateBudget(localId('budgets', shared.foodBudget.syncId), {
      categoryId: localId('categories', shared.food.syncId),
      periodMonth: '2026-09',
      amountMinor: rupees(12_000),
      currency: 'NPR',
    });
    investments.addPrice({
      assetId: localId('investment_assets', shared.asset.syncId),
      priceMinor: rupees(1_300),
      priceDate: '2026-09-21',
    });
    investments.sellAsset({
      assetId: localId('investment_assets', shared.asset.syncId),
      accountId: localId('accounts', shared.bank.syncId),
      quantityMinor: parseQuantity('1'),
      unitPriceMinor: rupees(1_300),
      tradeDate: september(21),
    });
    transactions.createLend({
      personId: localId('people', shared.ram.syncId),
      amountMinor: rupees(1_000),
      accountId: localId('accounts', shared.cash.syncId),
      transactionDate: september(21),
    });
    recurring.pauseRecurringTemplate(localId('recurring_templates', shared.template.syncId));

    onDevice(A);
    transactions.createIncome({
      amountMinor: rupees(2_000),
      categoryId: shared.salary.categoryId!,
      accountId: shared.bank.id,
      transactionDate: september(22),
      title: 'Bonus',
    });
    transactions.createTransfer({
      amountMinor: rupees(500),
      sourceAccountId: shared.cash.id,
      destinationAccountId: shared.bank.id,
      transactionDate: september(22),
    });

    for (let round = 0; round < 2; round += 1) {
      for (const device of [A, B] as const) {
        onDevice(device);
        await cycle();
      }
    }

    onDevice(A);
    const onA = logicalState();
    expect(verifySyncIntegrity().issues).toEqual([]);
    onDevice(B);
    expect(logicalState()).toEqual(onA);
    expect(verifySyncIntegrity().issues).toEqual([]);
    expect(onA.holdings[0]).toMatchObject({ quantityMinor: parseQuantity('5') });
    expect(onA.budget.categories).toEqual([[shared.food.name, rupees(12_000), rupees(5_700)]]);
    expect(onA.templates).toEqual([expect.objectContaining({ is_paused: 1 })]);
  });

  it('converges three devices’ independent offline changes with no duplicate, resurrection, negative holding or wrong budget', async () => {
    await setupDevice(C);
    await linkUsingCloudData(reconcile());

    onDevice(A);
    transactions.createExpense({
      amountMinor: rupees(1_000),
      categoryId: shared.food.id,
      accountId: shared.cash.id,
      transactionDate: september(21),
      title: 'Groceries',
    });
    onDevice(B);
    transactions.deleteTransaction(localId('transactions', shared.lunch.syncId));
    onDevice(C);
    transactions.updateExpense(localId('transactions', shared.lunch.syncId), {
      amountMinor: rupees(5_500),
    });
    investments.buyAsset({
      assetId: localId('investment_assets', shared.asset.syncId),
      accountId: localId('accounts', shared.bank.syncId),
      quantityMinor: parseQuantity('2'),
      unitPriceMinor: rupees(1_250),
      tradeDate: september(21),
    });
    onDevice(A);
    investments.addPrice({
      assetId: shared.asset.id,
      priceMinor: rupees(1_250),
      priceDate: '2026-09-22',
    });

    for (let round = 0; round < 3; round += 1) {
      for (const device of [A, B, C] as const) {
        onDevice(device);
        await cycle();
      }
    }

    onDevice(A);
    const onA = logicalState();
    for (const device of [B, C] as const) {
      onDevice(device);
      expect(logicalState(), device).toEqual(onA);
      // The deletion held on every device, whatever the late edit said.
      expect(isDeleted('transactions', shared.lunch.syncId), device).toBe(true);
      expect(verifySyncIntegrity().issues, device).toEqual([]);
    }
    const shape = cloudShape();
    for (const entity of ENTITIES) expect(shape[entity]?.rows, entity).toBe(shape[entity]?.unique);
    expect(onA.holdings[0]).toMatchObject({ quantityMinor: parseQuantity('8') });
    // Food this month is A's groceries alone: the deleted lunch counts nowhere.
    expect(onA.budget.categories).toEqual([[shared.food.name, rupees(10_000), rupees(1_000)]]);
  });

  it('keeps every deletion deleted when the other device edited the same record offline', async () => {
    onDevice(A);
    transactions.deleteTransaction(shared.lunch.id);
    budgetService.deleteBudget(shared.foodBudget.id);
    recurring.deleteRecurringTemplate(shared.template.id);
    investments.deleteTrade(shared.dividend.id);
    investments.deletePrice(shared.price.id);

    onDevice(B);
    transactions.updateExpense(localId('transactions', shared.lunch.syncId), {
      amountMinor: rupees(5_200),
    });
    budgetService.updateBudget(localId('budgets', shared.foodBudget.syncId), {
      categoryId: localId('categories', shared.food.syncId),
      periodMonth: '2026-09',
      amountMinor: rupees(11_000),
      currency: 'NPR',
    });
    recurring.updateRecurringTemplate(localId('recurring_templates', shared.template.syncId), {
      title: 'Fibre',
    });
    investments.updateTrade(localId('investment_trades', shared.dividend.syncId), {
      amountMinor: rupees(600),
    });
    investments.updatePrice(localId('investment_prices', shared.price.syncId), {
      priceMinor: rupees(1_250),
    });

    for (let round = 0; round < 2; round += 1) {
      for (const device of [A, B] as const) {
        onDevice(device);
        await cycle();
      }
    }

    const deleted: [string, string, string | null][] = [
      ['transactions', 'transaction', shared.lunch.syncId],
      ['budgets', 'budget', shared.foodBudget.syncId],
      ['recurring_templates', 'recurring_template', shared.template.syncId],
      ['investment_trades', 'investment_trade', shared.dividend.syncId],
      ['investment_prices', 'investment_price', shared.price.syncId],
    ];
    onDevice(A);
    const onA = logicalState();
    for (const device of [A, B] as const) {
      onDevice(device);
      for (const [table, entity, syncId] of deleted) {
        expect(isDeleted(table, syncId), `${device} ${table}`).toBe(true);
        const row = cloud.rowBySyncId(entity as never, syncId!) as
          { deleted_at: unknown } | undefined;
        expect(row?.deleted_at ?? null, `cloud ${entity}`).not.toBeNull();
      }
      expect(logicalState()).toEqual(onA);
      expect(
        portfolio.getHolding(localId('investment_assets', shared.asset.syncId)).dividendsMinor,
      ).toBe(0);
    }
  });
});
