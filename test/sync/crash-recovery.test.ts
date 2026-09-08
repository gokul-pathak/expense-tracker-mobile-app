import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

/** Lets a test make one specific stage of an apply throw, as a crash would. */
const crash = vi.hoisted(() => ({
  applyAccount: false,
  applyCategory: false,
  applyTransaction: false,
  /** Fails the whole-dataset replacement after its writes, to prove rollback. */
  replaceDataset: false,
}));

vi.mock('@/features/sync/remote-apply.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sync/remote-apply.repository')>();
  return {
    ...actual,
    applyRemoteAccount: (...args: Parameters<typeof actual.applyRemoteAccount>) => {
      if (crash.applyAccount) throw new Error('simulated interruption');
      return actual.applyRemoteAccount(...args);
    },
    applyRemoteCategory: (...args: Parameters<typeof actual.applyRemoteCategory>) => {
      if (crash.applyCategory) throw new Error('simulated interruption');
      return actual.applyRemoteCategory(...args);
    },
    applyRemoteTransaction: (...args: Parameters<typeof actual.applyRemoteTransaction>) => {
      if (crash.applyTransaction) throw new Error('simulated interruption');
      return actual.applyRemoteTransaction(...args);
    },
    replaceLocalDataFromRemote: (
      dataset: Parameters<typeof actual.replaceLocalDataFromRemote>[0],
      finalize: Parameters<typeof actual.replaceLocalDataFromRemote>[1],
    ) =>
      // The real deletes and inserts run, then the transaction is failed, so
      // this exercises the rollback rather than skipping the work.
      actual.replaceLocalDataFromRemote(dataset, (writer) => {
        finalize?.(writer);
        if (crash.replaceDataset) throw new Error('simulated interruption');
      }),
  };
});

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import { linkUsingCloudData, linkUsingLocalData } from '@/features/sync/reconciliation.service';
import { PullRemoteError, PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import {
  countPendingSyncMutations,
  getCloudBinding,
  getPendingSyncMutation,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { cloudAccount, cloudCategory, cloudTransaction, TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, reopenTestDatabase } from '../support/test-database';

/**
 * What survives an interruption.
 *
 * Every stage where a phone can be killed — mid-request, after the server
 * committed but before the device knew, between applying rows and moving the
 * cursor — is exercised here. The bar is the same at every stage: no duplicate
 * logical record, no lost local mutation, no cursor ahead of its data, and no
 * database that claims to be linked when it is not.
 */

const financialDate = new Date(2026, 0, 15);

let cloud: FakeCloud;

function resetCrashes() {
  crash.applyAccount = false;
  crash.applyCategory = false;
  crash.applyTransaction = false;
  crash.replaceDataset = false;
}

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

function reconcile(overrides: Record<string, unknown> = {}) {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason: string) => ({
        reason: reason as never,
        location: `memory://${reason}`,
        createdAt: new Date(),
      }),
      reseedDefaults: async () => false,
      ...overrides,
    },
  };
}

function addExpense(accountId: number, amountMinor: number, title = 'Lunch') {
  return transactionService.createExpense({
    accountId,
    categoryId: expenseCategory().id,
    amountMinor,
    title,
    paymentMode: 'cash',
    transactionDate: financialDate,
  });
}

describe('push crash matrix', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    resetCrashes();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('keeps the work queued when the request never leaves the device', async () => {
    makeAccount('Cash');
    cloud.failWith(() => new PushRemoteError('network'));

    const result = await push();

    expect(result.status).toBe('offline');
    expect(countPendingSyncMutations()).toBe(1);
    expect(cloud.rows('account')).toHaveLength(0);
  });

  it('recovers when the server committed but the device never heard back', async () => {
    const cash = makeAccount('Cash');
    // The cloud wrote the row, then the connection dropped before the reply.
    cloud.failAfterWriteWith(() => new PushRemoteError('network'));

    const interrupted = await push();

    expect(interrupted.status).toBe('offline');
    // Losing a queued change would be worse than repeating an idempotent one.
    expect(countPendingSyncMutations()).toBe(1);
    expect(cloud.rows('account')).toHaveLength(1);

    cloud.failAfterWriteWith(null);
    const retried = await push();

    expect(retried.status).toBe('success');
    expect(cloud.rows('account')).toHaveLength(1);
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Cash' });
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('survives a restart between the upload and the acknowledgement', async () => {
    makeAccount('Cash');
    cloud.failAfterWriteWith(() => new PushRemoteError('network'));
    await push();

    // The process dies; the database file is all that is left.
    reopenTestDatabase();
    cloud.failAfterWriteWith(null);

    expect(countPendingSyncMutations()).toBe(1);
    const result = await push();

    expect(result.status).toBe('success');
    expect(cloud.rows('account')).toHaveLength(1);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('never uploads the same record twice however often a run is interrupted', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      cloud.failAfterWriteWith(() => new PushRemoteError('network'));
      await push();
      cloud.failAfterWriteWith(null);
    }
    await push();

    expect(cloud.rows('account')).toHaveLength(1);
    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('keeps a newer edit pending when an in-flight upload is acknowledged', async () => {
    const cash = makeAccount('Cash');
    let edited = false;

    await pushPendingChanges({
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => ({
          upsert: async (entityType, rows) => {
            await cloud.repository.upsert(entityType, rows);
            if (!edited) {
              edited = true;
              // The user renames the account while the upload is in flight.
              accountService.updateAccount(cash.id, { name: 'Renamed mid-push' });
            }
          },
        }),
      },
    });

    // The acknowledgement matched an older generation, so the newer edit stands.
    expect(getPendingSyncMutation('account', cash.syncId!)).toMatchObject({ operation: 'upsert' });
    expect(accountService.getAccount(cash.id).name).toBe('Renamed mid-push');

    await push();
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Renamed mid-push' });
  });

  it('keeps a deletion pending when it lands during that record own upload', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = addExpense(cash.id, 5000);
    let deleted = false;

    await pushPendingChanges({
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => ({
          upsert: async (entityType, rows) => {
            await cloud.repository.upsert(entityType, rows);
            if (entityType === 'transaction' && !deleted) {
              deleted = true;
              // The user deletes the very record whose upsert is in flight.
              transactionService.deleteTransaction(expense.id);
            }
          },
        }),
      },
    });

    // The upload that succeeded was the older generation, so the deletion still
    // stands and will be sent.
    expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
      operation: 'delete',
    });
    expect(transactionService.listTransactions()).toHaveLength(0);

    await push();
    expect(cloud.rowBySyncId('transaction', expense.syncId!)).toMatchObject({
      deleted_at: expect.any(Number),
    });
    expect(countPendingSyncMutations()).toBe(0);
  });
});

describe('pull crash matrix', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    resetCrashes();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('leaves the cursor untouched when the change feed cannot be read', async () => {
    cloud.putRow('account', cloudAccount());
    cloud.failPullWith((call) =>
      call.kind === 'changes' ? new PullRemoteError('network') : undefined,
    );

    const result = await pull();

    expect(result.status).toBe('offline');
    expect(getSyncState()?.pullCursor).toBeNull();
    expect(accountService.listAccounts()).toHaveLength(0);
  });

  it('leaves the cursor untouched when the rows cannot be read', async () => {
    cloud.putRow('account', cloudAccount());
    cloud.failPullWith((call) =>
      call.kind === 'rows' ? new PullRemoteError('network') : undefined,
    );

    const result = await pull();

    expect(result.status).toBe('offline');
    expect(getSyncState()?.pullCursor).toBeNull();
    expect(accountService.listAccounts()).toHaveLength(0);
  });

  it('rolls the whole batch back when applying is interrupted part-way', async () => {
    cloud.putRow('account', cloudAccount({ name: 'First' }));
    cloud.putRow('account', cloudAccount({ name: 'Second' }));
    crash.applyAccount = true;

    const interrupted = await pull();

    expect(interrupted.status).toBe('error');
    // No half-applied batch, and no cursor ahead of the data.
    expect(accountService.listAccounts()).toHaveLength(0);
    expect(getSyncState()?.pullCursor).toBeNull();

    crash.applyAccount = false;
    const recovered = await pull();

    expect(recovered.status).toBe('success');
    expect(accountService.listAccounts()).toHaveLength(2);
  });

  it('rolls back a child failure without keeping its parents', async () => {
    const account = cloudAccount({ opening_balance_minor: 100000 });
    const category = cloudCategory();
    cloud.putRow('account', account);
    cloud.putRow('category', category);
    cloud.putRow(
      'transaction',
      cloudTransaction({
        category_sync_id: category.sync_id,
        source_account_sync_id: account.sync_id,
      }),
    );
    crash.applyTransaction = true;

    const interrupted = await pull();

    expect(interrupted.status).toBe('error');
    // The parents were in the same transaction, so they rolled back too.
    expect(accountService.listAccounts()).toHaveLength(0);
    expect(getSyncState()?.pullCursor).toBeNull();

    crash.applyTransaction = false;
    await pull();

    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(95000);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('re-applies safely when the cursor commit is lost to a restart', async () => {
    const account = cloudAccount({ opening_balance_minor: 100000 });
    const category = cloudCategory();
    cloud.putRow('account', account);
    cloud.putRow('category', category);
    cloud.putRow(
      'transaction',
      cloudTransaction({
        category_sync_id: category.sync_id,
        source_account_sync_id: account.sync_id,
      }),
    );
    await pull();
    const balance = getAccountBalance(accountService.listAccounts()[0]!.id);

    // The rows committed; the cursor did not survive the crash.
    updateSyncState({ pullCursor: 0 });
    reopenTestDatabase();
    const replay = await pull();

    expect(replay.status).toBe('idle');
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(balance);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('never advances past a change it refused, however often it retries', async () => {
    cloud.putRow('account', cloudAccount({ name: 'Good' }));
    const safeCursor = cloud.changes().at(-1)!.sequence;
    cloud.putRow('account', cloudAccount({ user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
    cloud.putRow('account', cloudAccount({ name: 'Later' }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await pull();
      expect(result.status).toBe('attention_required');
      expect(result.cursor).toBe(safeCursor);
    }

    expect(accountService.listAccounts().map((account) => account.name)).toEqual(['Good']);
  });
});

describe('reconciliation crash matrix', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    resetCrashes();
  });

  it('does not link when the safety backup fails', async () => {
    makeAccount('Cash', 'NPR', 100000);

    const result = await linkUsingLocalData(
      reconcile({
        createSafetyBackup: async () => {
          throw new Error('storage unavailable');
        },
      }),
    );

    expect(result).toMatchObject({ status: 'failed', reason: 'backup_failed' });
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
    expect(accountService.listAccounts()).toHaveLength(1);
  });

  it('does not link when the cloud cannot be inspected', async () => {
    makeAccount('Cash');
    cloud.failPullWith(() => new PullRemoteError('network'));

    const result = await linkUsingLocalData(reconcile());

    expect(result).toMatchObject({ status: 'failed', reason: 'network' });
    expect(getCloudBinding().linkedUserId).toBeNull();
  });

  it('does not link when the upload is interrupted, and finishes on retry', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    let allowed = 2;
    cloud.failWith(() => (allowed-- > 0 ? undefined : new PushRemoteError('network')));

    const interrupted = await linkUsingLocalData(reconcile());

    expect(interrupted.status).toBe('failed');
    // A half-uploaded account is not a linked device.
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
    expect(transactionService.listTransactions()).toHaveLength(1);

    cloud.failWith(null);
    const retried = await linkUsingLocalData(reconcile());

    expect(retried.status).toBe('linked');
    expect(getCloudBinding().linkedUserId).toBe(TEST_USER);
    expect(cloud.rows('account')).toHaveLength(1);
    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('does not link when the convergence pull is interrupted', async () => {
    makeAccount('Cash');
    // Seeded categories upload with no queued work, so the convergence pull
    // genuinely applies them, which is where this interruption lands.
    crash.applyCategory = true;

    const result = await linkUsingLocalData(reconcile());

    expect(result.status).toBe('failed');
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });

    crash.applyCategory = false;
    const retried = await linkUsingLocalData(reconcile());
    expect(retried.status).toBe('linked');
  });

  it('does not link when the download is interrupted, and leaves the device alone', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    cloud.putRow('account', cloudAccount({ name: 'Cloud' }));
    cloud.putRow(
      'transaction',
      cloudTransaction({ source_account_sync_id: cloudAccount().sync_id, category_sync_id: null }),
    );

    const result = await linkUsingCloudData(reconcile());

    expect(result.status).toBe('failed');
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getAccountBalance(cash.id)).toBe(95000);
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
  });

  it('does not link when the local replacement is interrupted', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    cloud.putRow('account', cloudAccount({ name: 'Cloud', opening_balance_minor: 1 }));
    cloud.putRow('category', cloudCategory({ name: 'Cloud category' }));
    crash.replaceDataset = true;

    const result = await linkUsingCloudData(reconcile());

    expect(result).toMatchObject({ status: 'failed', reason: 'apply_failed' });
    // The atomic replacement rolled back: the device still has its own data.
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(accountService.listAccounts()[0]!.syncId).toBe(cash.syncId);
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('leaves no half-linked database behind after any failure', async () => {
    makeAccount('Cash');
    cloud.failWith(() => new PushRemoteError('network'));

    await linkUsingLocalData(reconcile());

    const state = getSyncState();
    expect(state?.linkedUserId).toBeNull();
    expect(state?.pendingLinkUserId).toBeNull();
    // A restart must not find a database mid-link either.
    reopenTestDatabase();
    expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('restores the ability to save records after an interrupted setup', async () => {
    makeAccount('Cash');
    cloud.failWith(() => new PushRemoteError('network'));
    await linkUsingLocalData(reconcile());

    // Writes were suspended during setup; a failure must release them.
    expect(() => makeAccount('Added after failure')).not.toThrow();
    expect(accountService.listAccounts()).toHaveLength(2);
    expect(categoryService.listCategories().length).toBeGreaterThan(0);
  });
});
