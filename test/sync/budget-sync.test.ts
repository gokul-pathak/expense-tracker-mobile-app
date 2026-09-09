import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import * as categoryService from '@/features/categories/category.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { readLocalDataInventory } from '@/features/sync/data-inventory';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import {
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { listSyncConflicts } from '@/features/sync/sync-baseline.repository';
import { deriveCloudSyncStatus } from '@/features/sync/sync-status';
import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  updateSyncState,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import { cloudCategory, cloudSyncId, OTHER_USER, TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * Budgets across devices.
 *
 * A budget is a plan, so what travels is the plan: the month, the amount, the
 * currency and which category it applies to. What was spent never travels — each
 * device recomputes it from the transactions it holds, which is why two devices
 * holding the same records always agree without a derived number ever crossing
 * the network.
 */

const A = 'default';
const B = 'B';
const SEPTEMBER = '2026-09';
const rupees = (amount: number) => amount * 100;

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

function on(device: string) {
  onDevice(device);
}

/** A first link, so seeded categories reach the cloud the way they really do. */
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

function foodCategory() {
  const category = categoryService.listExpenseCategories().find((item) => item.name === 'Food');
  if (category === undefined) throw new Error('Seed has no Food category.');
  return category;
}

function makeCash() {
  return accountService.createAccount({
    name: 'Cash',
    type: 'cash',
    openingBalanceMinor: rupees(1_000_000),
    currency: 'NPR',
  });
}

function cloudBudget(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    category_sync_id: string | null;
    period_month: string;
    amount_minor: number | string;
    currency: string;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
  }> = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    category_sync_id: overrides.category_sync_id ?? null,
    period_month: overrides.period_month ?? SEPTEMBER,
    amount_minor: overrides.amount_minor ?? rupees(40_000),
    currency: overrides.currency ?? 'NPR',
    created_at: overrides.created_at ?? new Date(2026, 8, 1).getTime(),
    updated_at: overrides.updated_at ?? new Date(2026, 8, 2).getTime(),
    deleted_at: overrides.deleted_at ?? null,
  };
}

describe('budget upload', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('uploads the plan and nothing derived', async () => {
    const food = foodCategory();
    const cash = makeCash();
    const budget = budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(9_000),
      title: 'Food',
      transactionDate: new Date(2026, 8, 10),
    });

    await push();

    const uploaded = cloud.rowBySyncId('budget', budget.syncId!) as Record<string, unknown>;
    expect(uploaded).toEqual({
      sync_id: budget.syncId,
      user_id: TEST_USER,
      category_sync_id: food.syncId,
      period_month: SEPTEMBER,
      amount_minor: rupees(15_000),
      currency: 'NPR',
      created_at: budget.createdAt.getTime(),
      updated_at: budget.updatedAt.getTime(),
      deleted_at: null,
    });
    // No spent, remaining, percentage or status anywhere in the payload.
    expect(Object.keys(uploaded)).not.toContain('spent_minor');
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('sends the category as a global identity, never a local integer key', async () => {
    const food = foodCategory();
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    await push();

    const uploaded = cloud.rows('budget')[0] as Record<string, unknown>;
    expect(uploaded.category_sync_id).toBe(food.syncId);
    expect(JSON.stringify(uploaded)).not.toContain(`"${food.id}"`);
    expect(Object.keys(uploaded)).not.toContain('category_id');
  });

  it('uploads the category before the budget that references it', async () => {
    const category = categoryService.createCategory({ name: 'Coffee', type: 'expense' });
    budgetService.createBudget({
      categoryId: category.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(2_000),
    });

    await push();

    // The cloud has a foreign key from budget to category, so the parent has to
    // land first or the write is rejected.
    const order = cloud.calls.map((call) => call.entityType);
    expect(order.indexOf('category')).toBeLessThan(order.indexOf('budget'));
  });

  it('coalesces repeated edits into one queue entry and one upload', async () => {
    const budget = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });
    budgetService.updateBudget(budget.id, { amountMinor: rupees(41_000) });
    budgetService.updateBudget(budget.id, { amountMinor: rupees(42_000) });

    expect(countPendingSyncMutations()).toBe(1);
    await push();

    expect(cloud.rows('budget')).toHaveLength(1);
    expect(cloud.calls.filter((call) => call.entityType === 'budget')).toHaveLength(1);
    expect((cloud.rows('budget')[0] as { amount_minor: number }).amount_minor).toBe(rupees(42_000));
  });

  it('uploads a deletion as a tombstone once the device is linked', async () => {
    const budget = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });
    await push();

    budgetService.deleteBudget(budget.id);
    expect(getPendingSyncMutation('budget', budget.syncId!)?.operation).toBe('delete');
    await push();

    const tombstone = cloud.rowBySyncId('budget', budget.syncId!) as { deleted_at: number | null };
    expect(tombstone.deleted_at).not.toBeNull();
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('leaves a pending budget counted as an unsynchronized change', async () => {
    const budget = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });

    // A budget waiting to upload is exactly as unsynchronized as a transaction
    // waiting to upload: it uses the same queue, so it feeds the same status and
    // keeps the device from truthfully claiming to be synchronized.
    expect(countPendingSyncMutations()).toBe(1);
    expect(
      deriveCloudSyncStatus({
        configured: true,
        authenticatedUserId: TEST_USER,
        linkedUserId: TEST_USER,
        linking: false,
        reconciliationRequired: false,
        syncing: false,
        pendingChanges: countPendingSyncMutations(),
        attentionRequired: 0,
        lastError: null,
        offline: false,
      }),
    ).toBe('pending_changes');

    await push();
    expect(countPendingSyncMutations()).toBe(0);
    expect(getPendingSyncMutation('budget', budget.syncId!)).toBeNull();
  });
});

describe('budget download', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('applies a remote budget without queueing it straight back for upload', async () => {
    const category = cloudCategory({ name: 'Coffee', type: 'expense' });
    cloud.putRow('category', category);
    cloud.putRow('budget', cloudBudget({ category_sync_id: category.sync_id }));

    const result = await pull();

    expect(result.status).toBe('success');
    const [budget] = budgetService.listBudgetsForMonth(SEPTEMBER);
    expect(budget?.amountMinor).toBe(rupees(40_000));
    // Applying a download must never look like a local edit.
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('resolves the remote category identity to the local row', async () => {
    const food = foodCategory();
    cloud.putRow(
      'category',
      cloudCategory({
        sync_id: food.syncId!,
        name: 'Food',
        type: 'expense',
        system_key: 'expense_food',
        is_default: true,
      }),
    );
    cloud.putRow('budget', cloudBudget({ category_sync_id: food.syncId }));

    await pull();

    const [budget] = budgetService.listBudgetsForMonth(SEPTEMBER);
    expect(budget?.categoryId).toBe(food.id);
  });

  it('refuses a budget whose category is unknown rather than making it the overall budget', async () => {
    // Null already means something specific — the overall monthly budget — so a
    // missing parent can never be resolved by writing null.
    cloud.putRow('budget', cloudBudget({ category_sync_id: cloudSyncId() }));

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({ code: 'unknown_parent', detail: 'category' });
    expect(budgetService.listBudgets()).toEqual([]);
    // The cursor stops before the record instead of stepping over it.
    expect(result.cursor).toBe(0);
  });

  it('refuses a budget on an income category', async () => {
    const category = cloudCategory({ name: 'Salary', type: 'income' });
    cloud.putRow('category', category);
    cloud.putRow('budget', cloudBudget({ category_sync_id: category.sync_id }));

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({ detail: 'category_type' });
    expect(budgetService.listBudgets()).toEqual([]);
  });

  it('refuses a budget owned by another account even if the server returns it', async () => {
    cloud.putRow('budget', cloudBudget({ user_id: OTHER_USER }));

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(budgetService.listBudgets()).toEqual([]);
  });

  it('refuses a malformed month and a non-positive amount', async () => {
    cloud.putRow('budget', cloudBudget({ period_month: '2026-13' }));
    expect((await pull()).status).toBe('attention_required');
    expect(budgetService.listBudgets()).toEqual([]);

    cloud.reset();
    cloud.putRow('budget', cloudBudget({ amount_minor: 0 }));
    expect((await pull()).status).toBe('attention_required');
    expect(budgetService.listBudgets()).toEqual([]);
  });

  it('applies a remote tombstone by hiding the plan, not by removing its identity', async () => {
    const remote = cloudBudget();
    cloud.putRow('budget', remote);
    await pull();
    expect(budgetService.listBudgets()).toHaveLength(1);

    cloud.deleteRow('budget', remote.sync_id);
    await pull();

    expect(budgetService.listBudgets()).toEqual([]);
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER).overallBudget).toBeNull();
  });

  it('accepts a budget amount sent as a bigint string, exactly', async () => {
    cloud.putRow('budget', cloudBudget({ amount_minor: '4000000' }));

    await pull();

    expect(budgetService.listBudgetsForMonth(SEPTEMBER)[0]?.amountMinor).toBe(4_000_000);
  });
});

describe('two devices and a budget', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    // A links first and publishes its whole dataset, including the seeded
    // categories a budget may point at. B then restores from the cloud, which is
    // how a second device really joins.
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    await setupDevice(B);
    await linkUsingCloudData(reconcile());
    on(A);
  });
  afterAll(() => closeTestDatabase());

  it('carries a budget to the other device under the same identity', async () => {
    on(A);
    const food = foodCategory();
    const budget = budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    await push();

    on(B);
    await pull();

    const [received] = budgetService.listBudgetsForMonth(SEPTEMBER);
    expect(received?.syncId).toBe(budget.syncId);
    expect(received?.amountMinor).toBe(rupees(15_000));
    // Each device resolved the shared category to its own local key.
    expect(received?.categoryId).toBe(foodCategory().id);
  });

  it('derives the same spending on both devices from the same transactions', async () => {
    on(A);
    const food = foodCategory();
    const cash = makeCash();
    const budget = budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(5_000),
      title: 'Dinner',
      transactionDate: new Date(2026, 8, 3),
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(4_000),
      title: 'Groceries',
      transactionDate: new Date(2026, 8, 11),
    });
    await push();
    const onA = budgetService.getBudgetProgress(budget.id);

    on(B);
    await pull();
    const received = budgetService.listBudgetsForMonth(SEPTEMBER)[0]!;
    const onB = budgetService.getBudgetProgress(received.id);

    expect(onB.spentMinor).toBe(onA.spentMinor);
    expect(onB.remainingMinor).toBe(onA.remainingMinor);
    expect(onB.percentage).toBe(onA.percentage);
    expect(onB.status).toBe(onA.status);
    expect(onB.spentMinor).toBe(rupees(9_000));
  });

  it('resolves two offline edits to one budget with one deterministic winner', async () => {
    on(A);
    const food = foodCategory();
    const budget = budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    });
    await push();
    on(B);
    await pull();
    const onB = budgetService.listBudgetsForMonth(SEPTEMBER)[0]!;

    // Both devices raise the same budget while offline, to different amounts.
    on(A);
    budgetService.updateBudget(budget.id, { amountMinor: rupees(12_000) });
    on(B);
    budgetService.updateBudget(onB.id, { amountMinor: rupees(15_000) });

    on(A);
    await push();
    on(B);
    await pull();
    await push();
    on(A);
    await pull();
    on(B);
    await pull();

    // One budget, one amount, both devices agreeing, no second plan invented.
    on(A);
    const settledOnA = budgetService.listBudgetsForMonth(SEPTEMBER);
    on(B);
    const settledOnB = budgetService.listBudgetsForMonth(SEPTEMBER);

    expect(settledOnA).toHaveLength(1);
    expect(settledOnB).toHaveLength(1);
    expect(settledOnA[0]!.amountMinor).toBe(settledOnB[0]!.amountMinor);
    expect(settledOnA[0]!.syncId).toBe(settledOnB[0]!.syncId);
    expect(cloud.rows('budget')).toHaveLength(1);
    expect(listSyncConflicts().some((conflict) => conflict.entityType === 'budget')).toBe(true);
  });

  it('does not resurrect a budget one device deleted while the other edited it', async () => {
    on(A);
    const budget = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });
    await push();
    on(B);
    await pull();
    const onB = budgetService.listBudgetsForMonth(SEPTEMBER)[0]!;

    // A deletes; B edits the stale copy without knowing.
    on(A);
    budgetService.deleteBudget(budget.id);
    await push();
    on(B);
    budgetService.updateBudget(onB.id, { amountMinor: rupees(50_000) });

    // B downloads before it uploads, so the tombstone arrives first.
    await pull();
    await push();
    on(A);
    await pull();

    on(A);
    expect(budgetService.listBudgets()).toEqual([]);
    on(B);
    expect(budgetService.listBudgets()).toEqual([]);
    expect(
      (cloud.rowBySyncId('budget', budget.syncId!) as { deleted_at: number | null }).deleted_at,
    ).not.toBeNull();
  });

  it('converges to a fixed point and leaves both devices with a clean audit', async () => {
    on(A);
    const cash = makeCash();
    const food = foodCategory();
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(9_000),
      title: 'Food',
      transactionDate: new Date(2026, 8, 10),
    });
    await push();
    await pull();
    on(B);
    await pull();

    // A second round changes nothing anywhere: the cycle has a fixed point.
    on(A);
    expect((await pull()).applied).toBe(0);
    on(B);
    expect((await pull()).applied).toBe(0);

    for (const device of [A, B]) {
      on(device);
      expect(verifySyncIntegrity().issues).toEqual([]);
      const summary = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
      expect(summary.totalSpentMinor).toBe(rupees(9_000));
      expect(summary.totalBudgetedMinor).toBe(rupees(40_000));
      expect(summary.categoryBudgetedMinor).toBe(rupees(15_000));
    }
  });
});

describe('budgets and the rest of the sync engine', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('counts a budget as data worth protecting before a first link', () => {
    expect(readLocalDataInventory().hasMeaningfulData).toBe(false);

    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });

    // Nothing seeds or infers a budget, so any budget is a deliberate decision
    // that a "use the cloud's data" choice would destroy.
    const inventory = readLocalDataInventory();
    expect(inventory.budgets).toBe(1);
    expect(inventory.hasMeaningfulData).toBe(true);
  });

  it('leaves the other entities working exactly as before', async () => {
    const cash = makeCash();
    const food = foodCategory();
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(1_000),
      title: 'Lunch',
      transactionDate: new Date(2026, 8, 4),
    });
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });

    const result = await push();

    expect(result.status).toBe('success');
    expect(cloud.rows('account')).toHaveLength(1);
    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(cloud.rows('budget')).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('refuses a duplicate plan at the database, not only in the service', () => {
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });

    // The partial unique index collapses the overall budget's null category onto
    // one value, so even a write that goes round the service cannot produce two
    // plans for one month. SQLite treats distinct nulls as distinct in a unique
    // index, exactly as PostgreSQL does, so this needs the coalesce to work.
    expect(() =>
      insertBudgetDirectly({ periodMonth: SEPTEMBER, amountMinor: rupees(30_000) }),
    ).toThrow(/UNIQUE constraint/);
  });

  it('reports a duplicate plan without repairing it', () => {
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    // Only a database that lost its index could hold two live plans for one
    // month, which is exactly the corruption an audit exists to name.
    rawClient().exec('DROP INDEX uq_budget_live_period');
    insertBudgetDirectly({ periodMonth: SEPTEMBER, amountMinor: rupees(30_000) });

    const report = verifySyncIntegrity();

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      code: 'budget_duplicate_period',
      entityType: 'budget',
      count: 1,
    });
    expect(report.counts.budgets).toBe(2);
    // Reporting only: which of the two is the real plan is a question for a
    // person, so neither is discarded.
    expect(budgetService.listBudgetsForMonth(SEPTEMBER)).toHaveLength(2);
  });

  it('reports an impossible amount and month without repairing them', () => {
    // The schema refuses both, so the audit's own subject has to be built around
    // it — which is the point: these codes describe a database that should not
    // exist.
    insertBudgetDirectly({ periodMonth: '2026-9', amountMinor: -5 }, { withoutConstraints: true });

    const report = verifySyncIntegrity();

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['budget_invalid_amount', 'budget_invalid_month']),
    );
    expect(report.ok).toBe(false);
  });
});

describe('budgets and a first cloud link', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('uploads existing budgets when this device’s data is chosen', async () => {
    const food = foodCategory();
    // Created long before any account existed, so nothing is queued for it: an
    // ordinary push would leave it behind, which is why the first link reads the
    // dataset instead of the queue.
    const overall = budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    });
    const category = budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });

    const result = await linkUsingLocalData(reconcile());

    expect(result.status).toBe('linked');
    expect(cloud.rows('budget')).toHaveLength(2);
    const uploaded = cloud.rowBySyncId('budget', category.syncId!) as {
      category_sync_id: string | null;
      amount_minor: number;
    };
    expect(uploaded.category_sync_id).toBe(food.syncId);
    expect(uploaded.amount_minor).toBe(rupees(15_000));
    expect(
      (cloud.rowBySyncId('budget', overall.syncId!) as { category_sync_id: string | null })
        .category_sync_id,
    ).toBeNull();
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('retires a cloud budget this device does not have', async () => {
    const stale = cloudBudget({ period_month: '2026-08', amount_minor: rupees(5_000) });
    cloud.putRow('category', cloudCategory({ name: 'Coffee', type: 'expense' }));
    cloud.putRow('budget', stale);
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    makeCash();

    await linkUsingLocalData(reconcile());

    // Choosing this device's data is a replacement. A cloud plan left behind
    // would be downloaded straight back on the next pull.
    expect(
      (cloud.rowBySyncId('budget', stale.sync_id) as { deleted_at: number | null }).deleted_at,
    ).not.toBeNull();
    expect(budgetService.listBudgets()).toHaveLength(1);
    expect(budgetService.listBudgetsForMonth('2026-08')).toEqual([]);
  });

  it('restores cloud budgets onto a fresh device, with spending derived from the transactions', async () => {
    // Device A publishes a plan and the spending behind it.
    const cash = makeCash();
    const food = foodCategory();
    budgetService.createBudget({ periodMonth: SEPTEMBER, amountMinor: rupees(40_000) });
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: rupees(9_000),
      title: 'Food',
      transactionDate: new Date(2026, 8, 10),
    });
    await linkUsingLocalData(reconcile());
    const expected = budgetService.getMonthlyBudgetSummary(SEPTEMBER);

    // A new device restores from the cloud.
    await setupDevice(B);
    const restore = await linkUsingCloudData(reconcile());

    expect(restore.status).toBe('linked');
    const restored = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
    expect(restored.totalBudgetedMinor).toBe(expected.totalBudgetedMinor);
    expect(restored.categoryBudgetedMinor).toBe(expected.categoryBudgetedMinor);
    // Derived, not transported: the figure is recomputed from the restored
    // transactions and happens to match.
    expect(restored.totalSpentMinor).toBe(rupees(9_000));
    expect(restored.categoryBudgets[0]?.spentMinor).toBe(rupees(9_000));
    expect(restored.categoryBudgets[0]?.categoryName).toBe('Food');
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('leaves no local budget behind when the cloud’s data replaces it', async () => {
    const doomed = budgetService.createBudget({
      periodMonth: '2026-07',
      amountMinor: rupees(1_000),
    });
    cloud.putRow('account', {
      sync_id: cloudSyncId(),
      user_id: TEST_USER,
      name: 'Cloud cash',
      type: 'cash',
      opening_balance_minor: 0,
      currency: 'NPR',
      icon: null,
      is_archived: false,
      created_at: new Date(2026, 8, 1).getTime(),
      updated_at: new Date(2026, 8, 1).getTime(),
      deleted_at: null,
    });
    cloud.putRow('budget', cloudBudget());

    await linkUsingCloudData(reconcile());

    // The replacement is total: a plan the cloud does not have cannot survive it
    // and reappear as an upload later.
    const remaining = budgetService.listBudgets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.syncId).not.toBe(doomed.syncId);
    expect(remaining[0]!.periodMonth).toBe(SEPTEMBER);
    expect(countPendingSyncMutations()).toBe(0);
  });
});

/**
 * A write that goes round the service, so a test can either prove the database
 * refuses it or build the corrupt state an audit is supposed to find.
 *
 * `withoutConstraints` rebuilds the table with its checks removed, which is the
 * only way to store a budget the schema would otherwise reject.
 */
function insertBudgetDirectly(
  values: { periodMonth: string; amountMinor: number; categoryId?: number | null },
  options: { withoutConstraints?: boolean } = {},
) {
  const client = rawClient();
  if (options.withoutConstraints === true) {
    client.exec('DROP TABLE budgets');
    client.exec(
      'CREATE TABLE budgets (id integer PRIMARY KEY AUTOINCREMENT, category_id integer, period_month text NOT NULL, amount_minor integer NOT NULL, currency text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, sync_id text, deleted_at integer)',
    );
  }
  const now = Date.now();
  client
    .prepare(
      'INSERT INTO budgets (category_id, period_month, amount_minor, currency, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      values.categoryId ?? null,
      values.periodMonth,
      values.amountMinor,
      'NPR',
      now,
      now,
      cloudSyncId(),
    );
}
