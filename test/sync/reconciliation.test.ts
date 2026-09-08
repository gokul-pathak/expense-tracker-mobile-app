import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as settingsService from '@/features/settings/settings.service';
import {
  inspectCloudLink,
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { readLocalDataInventory } from '@/features/sync/data-inventory';
import { PullRemoteError, PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import { readSyncBaseline } from '@/features/sync/sync-baseline.repository';
import {
  countPendingSyncMutations,
  getCloudBinding,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
import { areUserMutationsSuspended } from '@/features/sync/sync-lock';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  cloudAccount,
  cloudCategory,
  cloudPerson,
  cloudSettings,
  cloudTransaction,
  OTHER_USER,
  TEST_USER,
} from '../support/cloud-rows';
import { expenseCategory, makeAccount, makePerson, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

const financialDate = new Date(2026, 0, 15);

let cloud: FakeCloud;
let backups: string[];

function reconcile(options: ReconciliationOptions = {}): ReconciliationOptions {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason) => {
        backups.push(reason);
        return { reason, location: `memory://${reason}`, createdAt: new Date() };
      },
      reseedDefaults: async () => false,
      ...options.dependencies,
    },
  };
}

/** A populated device: two accounts, a custom category, a person and history. */
function populateDevice() {
  const cash = makeAccount('Cash', 'NPR', 2000000);
  const bank = makeAccount('Bank', 'NPR', 5000000);
  const person = makePerson('Ram');
  const coffee = categoryService.createCategory({ name: 'Coffee', type: 'expense' });
  transactionService.createExpense({
    accountId: cash.id,
    categoryId: coffee.id,
    amountMinor: 5000,
    title: 'Espresso',
    paymentMode: 'cash',
    transactionDate: financialDate,
  });
  transactionService.createTransfer({
    sourceAccountId: bank.id,
    destinationAccountId: cash.id,
    amountMinor: 1000000,
    transactionDate: financialDate,
  });
  transactionService.createLend({
    personId: person.id,
    accountId: cash.id,
    amountMinor: 800000,
    transactionDate: financialDate,
  });
  return { cash, bank, person, coffee };
}

/** A cloud account that already holds another device's dataset. */
function populateCloud() {
  const account = cloudAccount({ name: 'Cloud Bank', opening_balance_minor: 1000000 });
  const category = cloudCategory({ name: 'Cloud Food' });
  const person = cloudPerson({ name: 'Sita' });
  const settings = cloudSettings({ default_currency: 'USD' });
  const expense = cloudTransaction({
    amount_minor: 25000,
    category_sync_id: category.sync_id,
    source_account_sync_id: account.sync_id,
    transaction_date: financialDate.getTime(),
  });
  cloud.putRow('settings', settings);
  cloud.putRow('account', account);
  cloud.putRow('category', category);
  cloud.putRow('person', person);
  cloud.putRow('transaction', expense);
  return { account, category, person, settings, expense };
}

describe('first cloud link', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    backups = [];
  });
  afterAll(() => closeTestDatabase());

  describe('inspection', () => {
    it('does not treat a fresh install as holding data', async () => {
      const result = await inspectCloudLink(reconcile());

      expect(result).toMatchObject({ status: 'ok' });
      if (result.status !== 'ok') return;
      // Seeded categories and an untouched settings row are not user data.
      expect(result.inspection.local.hasMeaningfulData).toBe(false);
      expect(result.inspection.case).toBe('A');
    });

    it('counts records that predate the outbox as local data', async () => {
      makeAccount('Cash');
      // Whatever the queue happens to hold, the account is still real data.
      updateSyncState({ linkedUserId: null });
      const inventory = readLocalDataInventory();

      const result = await inspectCloudLink(reconcile());

      expect(inventory.hasMeaningfulData).toBe(true);
      expect(result.status === 'ok' && result.inspection.case).toBe('B');
    });

    it('counts a changed default currency as a deliberate local decision', async () => {
      settingsService.updateDefaultCurrency('usd');

      const result = await inspectCloudLink(reconcile());

      expect(result.status === 'ok' && result.inspection.local.settingsChanged).toBe(true);
      expect(result.status === 'ok' && result.inspection.case).toBe('B');
    });

    it('recognises a populated cloud account', async () => {
      populateCloud();

      const result = await inspectCloudLink(reconcile());

      expect(result.status === 'ok' && result.inspection.case).toBe('C');
      expect(result.status === 'ok' && result.inspection.cloud.transactions).toBe(1);
    });

    it('recognises the dangerous case where both sides hold data', async () => {
      populateDevice();
      populateCloud();

      const result = await inspectCloudLink(reconcile());

      expect(result.status === 'ok' && result.inspection.case).toBe('D');
    });

    it('refuses to inspect while signed out', async () => {
      const result = await inspectCloudLink(
        reconcile({ dependencies: { getAuthenticatedUserId: async () => null } }),
      );

      expect(result).toMatchObject({ status: 'failed', reason: 'auth_required' });
    });
  });

  describe('case A — both empty', () => {
    it('links without uploading or replacing anything', async () => {
      const result = await linkUsingLocalData(reconcile());

      expect(result).toMatchObject({ status: 'linked', case: 'A' });
      expect(getCloudBinding()).toMatchObject({
        linkedUserId: TEST_USER,
        pendingLinkUserId: null,
      });
      // Nothing to protect, so no snapshot is taken.
      expect(backups).toHaveLength(0);
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  describe('case B — this device has data, the cloud is empty', () => {
    it('uploads the whole dataset, including rows that never queued work', async () => {
      const { cash, coffee } = populateDevice();
      // Records that predate the outbox: push alone would never send them.
      updateSyncState({ pullCursor: null });

      const result = await linkUsingLocalData(reconcile());

      expect(result).toMatchObject({ status: 'linked', case: 'B' });
      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({
        name: 'Cash',
        opening_balance_minor: 2000000,
      });
      expect(cloud.rowBySyncId('category', coffee.syncId!)).toMatchObject({ name: 'Coffee' });
      expect(cloud.rows('transaction')).toHaveLength(3);
      // Built-in categories travel too, so a second device reconciles by system key.
      expect(cloud.rows('category').length).toBe(categoryService.listCategories().length);
      expect(cloud.rows('settings')).toHaveLength(1);
    });

    it('creates a recovery snapshot before uploading', async () => {
      populateDevice();

      await linkUsingLocalData(reconcile());

      expect(backups).toEqual(['pre-cloud-link']);
    });

    it('leaves the local database completely intact', async () => {
      const { cash } = populateDevice();
      const balanceBefore = getAccountBalance(cash.id);
      const totalBefore = getTotalBalance();

      await linkUsingLocalData(reconcile());

      expect(getAccountBalance(cash.id)).toBe(balanceBefore);
      expect(getTotalBalance()).toBe(totalBefore);
      expect(transactionService.listTransactions()).toHaveLength(3);
    });

    it('establishes the cursor and the per-record baselines', async () => {
      const { cash } = populateDevice();

      const result = await linkUsingLocalData(reconcile());

      expect(result.status === 'linked' && result.cursor).toBeGreaterThan(0);
      expect(getSyncState()?.pullCursor).toBe(result.status === 'linked' ? result.cursor : null);
      expect(readSyncBaseline('account', cash.syncId!)?.serverRevision).toBe(1);
      // Setup finishes with nothing waiting: the cloud provably holds this data.
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('is retryable and does not bind the database when the upload fails', async () => {
      populateDevice();
      cloud.failWith(() => new PushRemoteError('network'));

      const failed = await linkUsingLocalData(reconcile());

      expect(failed).toMatchObject({ status: 'failed' });
      expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
      expect(transactionService.listTransactions()).toHaveLength(3);

      cloud.failWith(null);
      const retried = await linkUsingLocalData(reconcile());

      expect(retried).toMatchObject({ status: 'linked' });
      expect(getCloudBinding().linkedUserId).toBe(TEST_USER);
    });

    it('converges on one cloud row per record when a partial upload is retried', async () => {
      populateDevice();
      // The first statements land, then the connection drops part-way through.
      let allowed = 2;
      cloud.failWith(() => (allowed-- > 0 ? undefined : new PushRemoteError('network')));

      await linkUsingLocalData(reconcile());
      cloud.failWith(null);
      await linkUsingLocalData(reconcile());

      expect(cloud.rows('account')).toHaveLength(2);
      expect(cloud.rows('transaction')).toHaveLength(3);
    });
  });

  describe('case C — this device is empty, the cloud has data', () => {
    it('downloads the cloud dataset and derives its own figures', async () => {
      const remote = populateCloud();

      const result = await linkUsingCloudData(reconcile());

      expect(result).toMatchObject({ status: 'linked', case: 'C', choice: 'use_cloud' });
      const account = accountService.listAccounts()[0]!;
      expect(account).toMatchObject({ name: 'Cloud Bank', syncId: remote.account.sync_id });
      expect(personService.listPeople()[0]).toMatchObject({ name: 'Sita' });
      expect(settingsService.getAppSettings().defaultCurrency).toBe('USD');
      // Derived locally from the downloaded source rows, never downloaded.
      expect(getAccountBalance(account.id)).toBe(975000);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('keeps the cloud identities and gives rows local integer keys', async () => {
      const remote = populateCloud();

      await linkUsingCloudData(reconcile());

      const account = accountService.listAccounts()[0]!;
      const transaction = transactionService.listTransactions()[0]!;
      expect(account.syncId).toBe(remote.account.sync_id);
      expect(account.id).toBeGreaterThan(0);
      expect(transaction.sourceAccountId).toBe(account.id);
    });

    it('records the cursor and baselines so the next pull is incremental', async () => {
      const remote = populateCloud();

      const result = await linkUsingCloudData(reconcile());

      expect(result.status === 'linked' && result.cursor).toBeGreaterThan(0);
      expect(readSyncBaseline('account', remote.account.sync_id)?.serverRevision).toBe(1);
    });

    it('leaves the database untouched and unlinked when the download fails', async () => {
      populateCloud();
      cloud.failPullWith(() => new PullRemoteError('network'));

      const result = await linkUsingCloudData(reconcile());

      expect(result).toMatchObject({ status: 'failed', reason: 'network' });
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(getCloudBinding()).toMatchObject({ linkedUserId: null, pendingLinkUserId: null });
    });

    it('refuses invalid cloud data before clearing anything locally', async () => {
      const { cash } = populateDevice();
      const balanceBefore = getAccountBalance(cash.id);
      populateCloud();
      // A transaction pointing at an account that does not exist in the cloud.
      cloud.putRow(
        'transaction',
        cloudTransaction({
          source_account_sync_id: cloudAccount().sync_id,
          category_sync_id: null,
        }),
      );

      const result = await linkUsingCloudData(reconcile());

      expect(result).toMatchObject({ status: 'failed', reason: 'invalid_cloud_data' });
      expect(transactionService.listTransactions()).toHaveLength(3);
      expect(getAccountBalance(cash.id)).toBe(balanceBefore);
      expect(getCloudBinding().linkedUserId).toBeNull();
    });

    it('refuses a cloud dataset that breaks a debt invariant', async () => {
      const account = cloudAccount();
      const person = cloudPerson();
      cloud.putRow('account', account);
      cloud.putRow('person', person);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'repayment_received',
          amount_minor: 50000,
          destination_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Repayment received',
        }),
      );

      const result = await linkUsingCloudData(reconcile());

      expect(result).toMatchObject({
        status: 'failed',
        reason: 'invalid_cloud_data',
        detail: 'repayment_received_exceeds_lent',
      });
      expect(getCloudBinding().linkedUserId).toBeNull();
    });
  });

  describe('case D — both sides hold data', () => {
    it('replaces the cloud when the device wins, leaving nothing to pull back', async () => {
      const { cash } = populateDevice();
      const remote = populateCloud();

      const result = await linkUsingLocalData(reconcile());

      expect(result).toMatchObject({ status: 'linked', case: 'D', choice: 'use_local' });
      // The other device's records are retired rather than left to return.
      expect(cloud.rowBySyncId('account', remote.account.sync_id)).toMatchObject({
        deleted_at: expect.any(Number),
      });
      expect(cloud.rowBySyncId('transaction', remote.expense.sync_id)).toMatchObject({
        deleted_at: expect.any(Number),
      });
      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ deleted_at: null });
      expect(accountService.listAccounts()).toHaveLength(2);
    });

    it('takes a recovery snapshot before replacing the cloud', async () => {
      populateDevice();
      populateCloud();

      await linkUsingLocalData(reconcile());

      expect(backups).toEqual(['pre-cloud-replace']);
    });

    it('replaces the device when the cloud wins, leaving no local leftovers', async () => {
      const { cash } = populateDevice();
      const remote = populateCloud();

      const result = await linkUsingCloudData(reconcile());

      expect(result).toMatchObject({ status: 'linked', case: 'D', choice: 'use_cloud' });
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(accountService.listAccounts()[0]!.syncId).toBe(remote.account.sync_id);
      expect(
        accountService.listAccounts().find((account) => account.syncId === cash.syncId),
      ).toBeUndefined();
      expect(transactionService.listTransactions()).toHaveLength(1);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('takes a recovery snapshot before replacing the device', async () => {
      populateDevice();
      populateCloud();

      await linkUsingCloudData(reconcile());

      expect(backups).toEqual(['pre-cloud-restore']);
    });

    it('does not link when the safety backup cannot be written', async () => {
      populateDevice();
      populateCloud();

      const result = await linkUsingCloudData(
        reconcile({
          dependencies: {
            createSafetyBackup: async () => {
              throw new Error('no storage');
            },
          },
        }),
      );

      expect(result).toMatchObject({ status: 'failed', reason: 'backup_failed' });
      expect(transactionService.listTransactions()).toHaveLength(3);
      expect(getCloudBinding().linkedUserId).toBeNull();
    });
  });

  describe('safety rules', () => {
    it('suspends the user’s own writes for the critical section', async () => {
      populateDevice();
      let suspendedDuringUpload = false;

      await linkUsingLocalData(
        reconcile({
          dependencies: {
            createSafetyBackup: async (reason) => {
              suspendedDuringUpload = areUserMutationsSuspended();
              return { reason, location: 'memory://x', createdAt: new Date() };
            },
          },
        }),
      );

      expect(suspendedDuringUpload).toBe(true);
      // Writes are released however the run ends.
      expect(areUserMutationsSuspended()).toBe(false);
      expect(() => makeAccount('After setup')).not.toThrow();
    });

    it('refuses to reconcile into a database bound to another account', async () => {
      updateSyncState({ linkedUserId: OTHER_USER });

      const result = await linkUsingLocalData(reconcile());

      expect(result).toMatchObject({ status: 'failed', reason: 'account_mismatch' });
      expect(getCloudBinding().linkedUserId).toBe(OTHER_USER);
    });

    it('does nothing when this build has no cloud configuration', async () => {
      const result = await linkUsingLocalData(
        reconcile({ dependencies: { createRemote: () => null } }),
      );

      expect(result).toMatchObject({ status: 'failed', reason: 'unavailable' });
    });

    it('runs one reconciliation at a time', async () => {
      populateDevice();

      const [first, second] = await Promise.all([
        linkUsingLocalData(reconcile()),
        linkUsingLocalData(reconcile()),
      ]);

      const statuses = [first.status, second.status];
      expect(statuses).toContain('linked');
      expect(statuses).toContain('failed');
      expect(cloud.rows('account')).toHaveLength(2);
    });
  });

  describe('seeding after a cloud restore', () => {
    it('re-seeds defaults when the cloud account had no categories', async () => {
      const account = cloudAccount();
      cloud.putRow('account', account);
      let reseeded = false;

      await linkUsingCloudData(
        reconcile({
          dependencies: {
            reseedDefaults: async () => {
              reseeded = categoryService.listCategories().length === 0;
              return reseeded;
            },
          },
        }),
      );

      expect(reseeded).toBe(true);
    });

    it('does not duplicate built-in categories that arrived from the cloud', async () => {
      const builtIn = cloudCategory({
        name: 'Food',
        system_key: 'expense_food',
        is_default: true,
      });
      cloud.putRow('account', cloudAccount());
      cloud.putRow('category', builtIn);

      await linkUsingCloudData(reconcile());

      const food = categoryService
        .listCategories()
        .filter((category) => category.systemKey === 'expense_food');
      expect(food).toHaveLength(1);
      expect(food[0]!.syncId).toBe(builtIn.sync_id);
    });
  });
});

describe('reconciliation helpers', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    backups = [];
  });

  it('reports what a seeded database contains', () => {
    const inventory = readLocalDataInventory();

    expect(inventory).toMatchObject({
      accounts: 0,
      transactions: 0,
      people: 0,
      customCategories: 0,
      settingsChanged: false,
      hasMeaningfulData: false,
    });
  });

  it('counts a custom category but not a built-in one', () => {
    expect(readLocalDataInventory().hasMeaningfulData).toBe(false);
    expenseCategory();

    categoryService.createCategory({ name: 'Coffee', type: 'expense' });

    expect(readLocalDataInventory()).toMatchObject({
      customCategories: 1,
      hasMeaningfulData: true,
    });
  });
});
