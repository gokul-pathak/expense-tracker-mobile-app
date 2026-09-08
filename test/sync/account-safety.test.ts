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
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import {
  BACKUP_FORMAT,
  LEGACY_BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_SCHEMA_VERSION,
  type LegacyBackupEnvelope,
} from '@/features/backup/backup.types';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import {
  inspectCloudLink,
  linkUsingCloudData,
  linkUsingLocalData,
} from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations, getCloudBinding } from '@/features/sync/sync.repository';
import { signOutKeepingLocalData, syncNow } from '@/features/sync/sync.service';
import * as transactionService from '@/features/transactions/transaction.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { OTHER_USER, TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

/**
 * The account boundary.
 *
 * One local database belongs to one cloud account. Everything here is about the
 * moments where that could go wrong: signing out and back in, signing in as
 * somebody else, and restoring a backup that predates cloud sync entirely. The
 * bar is that no data ever moves between two accounts without a person choosing
 * it, and that no path silently binds a database to an account it has not agreed
 * with.
 */

const financialDate = new Date(2026, 0, 15);

let cloud: FakeCloud;

function reconcile(userId: string) {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => userId,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason: string) => ({
        reason: reason as never,
        location: `memory://${reason}`,
        createdAt: new Date(),
      }),
      reseedDefaults: async () => false,
    },
  };
}

function sync(userId: string) {
  return syncNow({
    push: {
      dependencies: {
        getAuthenticatedUserId: async () => userId,
        createRemote: () => cloud.repository,
      },
    },
    pull: {
      dependencies: {
        getAuthenticatedUserId: async () => userId,
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

describe('signing out and back into the same account', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    authControl.signedOut = 0;
  });
  afterAll(() => closeTestDatabase());

  it('re-links safely and does not duplicate anything', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    await sync(TEST_USER);

    await signOutKeepingLocalData();
    expect(getCloudBinding().linkedUserId).toBeNull();

    // Offline work continues while unlinked.
    addExpense(cash.id, 1500, 'While signed out');
    expect(transactionService.listTransactions()).toHaveLength(2);

    // Signing back in offers the ordinary first-link flow, not a silent bind.
    const inspection = await inspectCloudLink(reconcile(TEST_USER));
    expect(inspection.status).toBe('ok');
    expect(inspection.status === 'ok' && inspection.inspection.case).toBe('D');

    const relinked = await linkUsingLocalData(reconcile(TEST_USER));

    expect(relinked.status).toBe('linked');
    expect(transactionService.listTransactions()).toHaveLength(2);
    expect(cloud.rows('transaction')).toHaveLength(2);
    expect(cloud.rows('account')).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('keeps unsent work while unlinked and sends it after re-linking', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    await linkUsingLocalData(reconcile(TEST_USER));
    addExpense(cash.id, 5000, 'Unsent');
    await signOutKeepingLocalData();

    // Unsent intent is the user's, and unlinking is not a reason to discard it.
    expect(countPendingSyncMutations()).toBeGreaterThan(0);
    const blocked = await sync(TEST_USER);
    expect(blocked.status).toBe('not_linked');

    await linkUsingLocalData(reconcile(TEST_USER));

    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
  });
});

describe('signing in as a different account', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    authControl.signedOut = 0;
  });

  it('blocks every sync path while the device is linked to someone else', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    const cloudRows = cloud.rows('transaction').length;
    addExpense(cash.id, 7000, 'After the switch');

    // Every route that could publish A's data to B.
    expect((await sync(OTHER_USER)).status).toBe('account_mismatch');
    expect((await linkUsingLocalData(reconcile(OTHER_USER))).status).toBe('failed');
    expect((await linkUsingCloudData(reconcile(OTHER_USER))).status).toBe('failed');
    const inspection = await inspectCloudLink(reconcile(OTHER_USER));
    expect(inspection).toMatchObject({ status: 'failed', reason: 'account_mismatch' });

    // A's data stayed on A's device and in A's account.
    expect(cloud.rows('transaction')).toHaveLength(cloudRows);
    expect(transactionService.listTransactions()).toHaveLength(2);
    expect(getCloudBinding().linkedUserId).toBe(TEST_USER);
  });

  it('requires a deliberate first link after the previous account is detached', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    const firstAccountRows = cloud.rows('transaction').length;

    // The user signs out, keeping the data, then signs in as somebody else.
    // From B's session the cloud shows only B's rows, as row level security does.
    await signOutKeepingLocalData();
    cloud.enforceOwner(OTHER_USER);
    const inspection = await inspectCloudLink(reconcile(OTHER_USER));

    // Nothing has been bound or uploaded: it is a choice, not a consequence.
    expect(inspection.status).toBe('ok');
    expect(inspection.status === 'ok' && inspection.inspection.case).toBe('B');
    expect(getCloudBinding().linkedUserId).toBeNull();
    expect(cloud.rows('transaction')).toHaveLength(firstAccountRows);
  });

  it('cannot move records that already belong to another account, and fails safely', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    const rowsOwnedByA = cloud
      .rows('transaction')
      .filter((row) => (row as unknown as { user_id: string }).user_id === TEST_USER).length;

    await signOutKeepingLocalData();
    cloud.enforceOwner(OTHER_USER);

    // These records still carry the identities they were given under A, and the
    // database will not let B write over an identity it does not own. The upload
    // is refused rather than quietly re-homing A's records under B.
    const attempted = await linkUsingLocalData(reconcile(OTHER_USER));

    expect(attempted.status).toBe('failed');
    expect(getCloudBinding().linkedUserId).toBeNull();
    // Both sides are exactly as they were.
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getAccountBalance(cash.id)).toBe(95000);
    expect(
      cloud
        .rows('transaction')
        .filter((row) => (row as unknown as { user_id: string }).user_id === TEST_USER),
    ).toHaveLength(rowsOwnedByA);
    expect(
      cloud
        .rows('transaction')
        .filter((row) => (row as unknown as { user_id: string }).user_id === OTHER_USER),
    ).toHaveLength(0);
  });

  it('never lets one account read the other account rows', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));

    // The cloud now enforces ownership the way row level security does.
    cloud.enforceOwner(OTHER_USER);
    const result = await sync(OTHER_USER);

    expect(result.status).toBe('account_mismatch');
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getAccountBalance(cash.id)).toBe(95000);
  });
});

describe('restoring a backup on a linked device', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
  });

  it('unlinks and requires a reconciliation before anything is published', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    const backup = createBackup();
    addExpense(cash.id, 9000, 'Newer than the backup');
    await sync(TEST_USER);
    expect(cloud.rows('transaction')).toHaveLength(2);

    restoreBackup(backup);

    expect(getCloudBinding()).toMatchObject({
      linkedUserId: null,
      reconciliationRequired: true,
    });
    expect(transactionService.listTransactions()).toHaveLength(1);
    // The newer cloud data is still there: an old backup cannot quietly erase it.
    expect((await sync(TEST_USER)).status).toBe('reconciliation_required');
    expect(cloud.rows('transaction')).toHaveLength(2);
  });

  it('restores a pre-cloud backup with fresh identities and no automatic upload', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await linkUsingLocalData(reconcile(TEST_USER));
    const cloudRows = cloud.rows('transaction').length;

    // A version 1 backup predates sync identity entirely.
    const legacy: LegacyBackupEnvelope = {
      format: BACKUP_FORMAT,
      formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
      schemaVersion: LEGACY_BACKUP_SCHEMA_VERSION,
      createdAt: new Date(2025, 5, 1).toISOString(),
      appVersion: '0.1.0',
      data: {
        accounts: [
          {
            id: 1,
            name: 'Old cash',
            type: 'cash',
            openingBalanceMinor: 250000,
            currency: 'NPR',
            icon: null,
            isArchived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        categories: [],
        people: [],
        transactions: [],
        settings: [
          {
            id: 1,
            defaultCurrency: 'NPR',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        appMetadata: [],
      },
    };

    restoreBackup(legacy);

    const restored = accountService.listAccounts();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ name: 'Old cash', openingBalanceMinor: 250000 });
    // Fresh, valid identities were assigned so the rows can sync later.
    expect(restored[0]!.syncId).not.toBeNull();
    expect(verifySyncIntegrity().issues).toEqual([]);
    // And nothing was published on the way.
    expect(getCloudBinding().reconciliationRequired).toBe(true);
    expect(cloud.rows('transaction')).toHaveLength(cloudRows);
  });
});
