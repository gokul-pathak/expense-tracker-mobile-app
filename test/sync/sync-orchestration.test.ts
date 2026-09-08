import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

const authControl = vi.hoisted(() => ({ signedOut: 0 }));
vi.mock('@/features/cloud-auth/auth.service', () => ({
  cloudAuthService: {
    isConfigured: true,
    getSession: async () => null,
    signOut: async () => {
      authControl.signedOut += 1;
    },
  },
}));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import { PullRemoteError, PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import {
  countPendingSyncMutations,
  getCloudBinding,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
import { onSyncedDataChanged } from '@/features/sync/sync-events';
import {
  canSyncNow,
  deriveCloudSyncStatus,
  isCloudLinked,
  type CloudSyncFacts,
} from '@/features/sync/sync-status';
import {
  readCloudSyncState,
  removeCloudDataFromDevice,
  signOutKeepingLocalData,
  syncNow,
  unlinkCloudAccount,
} from '@/features/sync/sync.service';
import * as transactionService from '@/features/transactions/transaction.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { cloudAccount, OTHER_USER, TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

const financialDate = new Date(2026, 0, 15);

let cloud: FakeCloud;

function sync() {
  return syncNow({
    push: {
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => cloud.repository,
      },
    },
    pull: {
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => cloud.pullRepository,
      },
    },
  });
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

const baseFacts: CloudSyncFacts = {
  configured: true,
  authenticatedUserId: TEST_USER,
  linkedUserId: TEST_USER,
  linking: false,
  reconciliationRequired: false,
  syncing: false,
  pendingChanges: 0,
  attentionRequired: 0,
  lastError: null,
  offline: false,
};

describe('sync status model', () => {
  it('says local only when the build has no cloud configuration', () => {
    expect(deriveCloudSyncStatus({ ...baseFacts, configured: false })).toBe('unconfigured');
  });

  it('says local only when signed out and never linked', () => {
    expect(
      deriveCloudSyncStatus({ ...baseFacts, authenticatedUserId: null, linkedUserId: null }),
    ).toBe('local_only');
  });

  it('asks for setup when signed in but not yet linked', () => {
    expect(deriveCloudSyncStatus({ ...baseFacts, linkedUserId: null })).toBe('setup_required');
  });

  it('blocks on an account mismatch', () => {
    expect(deriveCloudSyncStatus({ ...baseFacts, linkedUserId: OTHER_USER })).toBe(
      'account_mismatch',
    );
  });

  it('claims Synced only when nothing at all is outstanding', () => {
    expect(deriveCloudSyncStatus(baseFacts)).toBe('synced');
    expect(deriveCloudSyncStatus({ ...baseFacts, pendingChanges: 3 })).toBe('pending_changes');
    expect(deriveCloudSyncStatus({ ...baseFacts, offline: true })).toBe('offline');
    expect(deriveCloudSyncStatus({ ...baseFacts, attentionRequired: 1 })).toBe(
      'attention_required',
    );
    expect(deriveCloudSyncStatus({ ...baseFacts, lastError: 'network' })).toBe('error');
    expect(deriveCloudSyncStatus({ ...baseFacts, syncing: true })).toBe('syncing');
    expect(deriveCloudSyncStatus({ ...baseFacts, reconciliationRequired: true })).toBe(
      'reconciliation_required',
    );
  });

  it('keeps a signed-out but still-linked device out of local-only', () => {
    expect(deriveCloudSyncStatus({ ...baseFacts, authenticatedUserId: null })).toBe(
      'auth_required',
    );
  });

  it('knows when a sync may be started and when the device is linked', () => {
    expect(canSyncNow('synced')).toBe(true);
    expect(canSyncNow('offline')).toBe(true);
    expect(canSyncNow('setup_required')).toBe(false);
    expect(canSyncNow('syncing')).toBe(false);
    expect(isCloudLinked('local_only')).toBe(false);
    expect(isCloudLinked('pending_changes')).toBe(true);
  });
});

describe('sync orchestration', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    authControl.signedOut = 0;
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('uploads, downloads and reports a complete cycle', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    cloud.putRow('account', cloudAccount({ name: 'From another device' }));

    const result = await sync();

    expect(result).toMatchObject({ status: 'success', pending: 0 });
    expect(result.pushed).toBeGreaterThan(0);
    expect(result.pulled).toBeGreaterThan(0);
    expect(accountService.listAccounts()).toHaveLength(2);
    expect(getSyncState()?.lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });

  it('does not claim a successful sync when the upload failed', async () => {
    makeAccount('Cash');
    cloud.failWith(() => new PushRemoteError('network'));

    const result = await sync();

    expect(result.status).toBe('offline');
    expect(getSyncState()?.lastSuccessfulSyncAt).toBeNull();
    // Work is kept, not lost.
    expect(countPendingSyncMutations()).toBe(1);
  });

  it('does not upload at all when the download fails first', async () => {
    makeAccount('Cash');
    cloud.failPullWith(() => new PullRemoteError('network'));

    const result = await sync();

    // Downloading first is what makes deletion safe, so a failed download stops
    // the cycle before anything is published.
    expect(result.status).toBe('offline');
    expect(result.pushed).toBe(0);
    expect(cloud.rows('account')).toHaveLength(0);
    expect(getSyncState()?.lastSuccessfulSyncAt).toBeNull();
    // The work is kept for the next attempt.
    expect(countPendingSyncMutations()).toBe(1);
  });

  it('pushes again when a conflict left a local change queued', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    await sync();
    const remote = cloud.rowBySyncId('account', cash.syncId!) as unknown as Record<string, unknown>;
    cloud.putRow('account', { ...remote, name: 'Remote edit' });

    // The user edits while the download is in flight, so the change misses the
    // first push and the pull decides it wins.
    let edited = false;
    const result = await syncNow({
      push: {
        dependencies: {
          getAuthenticatedUserId: async () => TEST_USER,
          createRemote: () => cloud.repository,
        },
      },
      pull: {
        dependencies: {
          getAuthenticatedUserId: async () => TEST_USER,
          createRemote: () => ({
            fetchChanges: cloud.pullRepository.fetchChanges,
            fetchRows: async (entityType, syncIds) => {
              const rows = await cloud.pullRepository.fetchRows(entityType, syncIds);
              if (!edited) {
                edited = true;
                accountService.updateAccount(cash.id, { name: 'Local edit' });
              }
              return rows;
            },
          }),
        },
      },
    });

    expect(result.conflicts).toBeGreaterThan(0);
    // The winner reached the cloud in the same cycle, so nothing is left over.
    expect(result.pending).toBe(0);
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Local edit' });
    expect(accountService.getAccount(cash.id).name).toBe('Local edit');
  });

  it('converges without a conflict when only this device changed', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    await sync();
    accountService.updateAccount(cash.id, { name: 'Local edit' });

    const result = await sync();

    // The download finds nothing newer, so the local edit is simply uploaded.
    expect(result.conflicts).toBe(0);
    expect(result.status).toBe('success');
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Local edit' });
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('does not resurrect a record another device deleted while this one edited it', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = addExpense(cash.id, 5000);
    await sync();

    // Another device deletes it and publishes the tombstone.
    const remote = cloud.rowBySyncId('transaction', expense.syncId!) as unknown as Record<
      string,
      unknown
    >;
    cloud.putRow('transaction', { ...remote, deleted_at: Date.now() });
    // This device, offline until now, edited the same record.
    transactionService.updateExpense(expense.id, { amountMinor: 9000 });

    await sync();

    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(cloud.rowBySyncId('transaction', expense.syncId!)).toMatchObject({
      deleted_at: expect.any(Number),
    });
    // A further cycle must not bring it back either.
    await sync();
    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(getAccountBalance(cash.id)).toBe(100000);
  });

  it('runs one cycle at a time however often it is asked', async () => {
    makeAccount('Cash');

    const results = await Promise.all([sync(), sync(), sync()]);

    expect(results.filter((result) => result.status === 'success')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'busy')).toHaveLength(2);
    expect(cloud.rows('account')).toHaveLength(1);
  });

  it('tells focused screens to re-read after a pull changed something', async () => {
    let notified = 0;
    const stop = onSyncedDataChanged(() => {
      notified += 1;
    });
    cloud.putRow('account', cloudAccount({ name: 'From another device' }));

    await sync();
    stop();

    expect(notified).toBe(1);
  });

  it('refuses to sync a database bound to a different account', async () => {
    updateSyncState({ linkedUserId: OTHER_USER });
    makeAccount('Cash');

    const result = await sync();

    expect(result.status).toBe('account_mismatch');
    expect(cloud.calls).toHaveLength(0);
    expect(accountService.listAccounts()).toHaveLength(1);
  });

  it('reports what the Cloud Sync screen should show', async () => {
    const cash = makeAccount('Cash');
    await sync();
    addExpense(cash.id, 1000);

    const state = readCloudSyncState({ configured: true, authenticatedUserId: TEST_USER });

    expect(state).toMatchObject({
      status: 'pending_changes',
      linkedUserId: TEST_USER,
      pendingChanges: 1,
      attentionRequired: 0,
    });
    expect(state.lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });
});

describe('sign out and unlink', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    authControl.signedOut = 0;
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('keeps every financial record when the user keeps local data', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await sync();

    await signOutKeepingLocalData();

    expect(accountService.listAccounts()).toHaveLength(1);
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(accountService.listAccounts()[0]!.syncId).toBe(cash.syncId);
    expect(authControl.signedOut).toBe(1);
  });

  it('clears the cloud relationship without touching the data', async () => {
    makeAccount('Cash');
    await sync();

    await signOutKeepingLocalData();

    expect(getCloudBinding()).toMatchObject({
      linkedUserId: null,
      pendingLinkUserId: null,
      reconciliationRequired: false,
    });
    expect(getSyncState()?.pullCursor).toBeNull();
    expect(getSyncState()?.lastSuccessfulSyncAt).toBeNull();
  });

  it('cannot push after signing out, so nothing leaks to the old account', async () => {
    const cash = makeAccount('Cash');
    await sync();
    await signOutKeepingLocalData();
    accountService.updateAccount(cash.id, { name: 'Renamed offline' });

    const pushed = await pushPendingChanges({
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => cloud.repository,
      },
    });

    expect(pushed.status).toBe('not_linked');
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Cash' });
    // The unsent edit is still the user's intent, and is kept.
    expect(countPendingSyncMutations()).toBe(1);
  });

  it('removes this device’s copy without claiming to delete the cloud', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await sync();
    const cloudRowsBefore = cloud.rows('transaction').length;

    await removeCloudDataFromDevice();

    expect(accountService.listAccounts()).toHaveLength(0);
    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(countPendingSyncMutations()).toBe(0);
    expect(getCloudBinding().linkedUserId).toBeNull();
    // The account keeps its data: this was a local removal.
    expect(cloud.rows('transaction')).toHaveLength(cloudRowsBefore);
    // The app is still usable: defaults come back.
    expect(categoryService.listCategories().length).toBeGreaterThan(0);
  });

  it('unlinks without signing out when the user only wants to detach', async () => {
    makeAccount('Cash');
    await sync();

    unlinkCloudAccount();

    expect(getCloudBinding().linkedUserId).toBeNull();
    expect(authControl.signedOut).toBe(0);
    expect(accountService.listAccounts()).toHaveLength(1);
  });
});

describe('backup restore while linked', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('blocks sync until the user reconciles, instead of overwriting the cloud', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await sync();
    const backup = createBackup();
    addExpense(cash.id, 9000, 'Later expense');
    await sync();

    restoreBackup(backup);

    // The restored dataset has never been agreed with the cloud.
    expect(getCloudBinding()).toMatchObject({
      linkedUserId: null,
      reconciliationRequired: true,
    });
    expect(transactionService.listTransactions()).toHaveLength(1);

    const blocked = await sync();
    expect(blocked.status).toBe('reconciliation_required');
    // The cloud still holds what it held: nothing was pushed over it.
    expect(cloud.rows('transaction')).toHaveLength(2);
  });

  it('refuses an ordinary pull into a restored database', async () => {
    makeAccount('Cash');
    await sync();
    restoreBackup(createBackup());
    updateSyncState({ linkedUserId: TEST_USER });

    const pulled = await pullRemoteChanges({
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => cloud.pullRepository,
      },
    });

    expect(pulled.status).toBe('reconciliation_required');
  });
});
