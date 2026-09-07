import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as settingsService from '@/features/settings/settings.service';
import {
  PUSH_BATCH_SIZE,
  pushPendingChanges,
  type PushSyncOptions,
} from '@/features/sync/push-sync.service';
import { PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  getSyncState,
  listPendingSyncMutations,
  updateSyncState,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  expenseCategory,
  incomeCategory,
  makeAccount,
  makePerson,
  setupDatabase,
} from '../support/domain';
import { createFakeCloud, failOnce, type FakeCloud } from '../support/fake-cloud';
import {
  closeTestDatabase,
  migrateTestDatabase,
  rawClient,
  reopenTestDatabase,
} from '../support/test-database';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const date = new Date(2026, 0, 15);

let cloud: FakeCloud;

function push(options: PushSyncOptions = {}) {
  return pushPendingChanges({
    ...options,
    dependencies: {
      getAuthenticatedUserId: async () => USER,
      createRemote: () => cloud.repository,
      ...options.dependencies,
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
    transactionDate: date,
  });
}

describe('push sync engine', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: USER });
  });
  afterAll(() => closeTestDatabase());

  describe('acknowledgement', () => {
    it('uploads a queued account and clears exactly that work', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);

      const result = await push();

      expect(result).toMatchObject({ status: 'success', processed: 1, succeeded: 1, failed: 0 });
      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({
        sync_id: cash.syncId,
        user_id: USER,
      });
      expect(countPendingSyncMutations()).toBe(0);
      expect(getSyncState()?.lastSuccessfulPushAt).toBeInstanceOf(Date);
    });

    it('records push progress without claiming the device is synced', async () => {
      makeAccount('Cash');

      await push();

      const state = getSyncState();
      expect(state?.lastSuccessfulPushAt).toBeInstanceOf(Date);
      // Pull does not exist, so a full-sync marker must stay empty.
      expect(state?.lastSuccessfulSyncAt).toBeNull();
      expect(state?.lastSyncError).toBeNull();
    });

    it('converges on one cloud row when the same work is uploaded twice', async () => {
      const cash = makeAccount('Cash');
      await push();

      accountService.updateAccount(cash.id, { name: 'Wallet' });
      await push();

      expect(cloud.rows('account')).toHaveLength(1);
      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Wallet' });
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('keeps one settings row however often it is pushed', async () => {
      settingsService.updateDefaultCurrency('usd');
      await push();
      settingsService.updateDefaultCurrency('eur');
      await push();
      settingsService.updateDefaultCurrency('npr');
      await push();

      expect(cloud.rows('settings')).toHaveLength(1);
      expect(cloud.rows('settings')[0]).toMatchObject({ default_currency: 'NPR' });
    });

    it('repeats the upload safely when acknowledgement fails after remote success', async () => {
      const cash = makeAccount('Cash');
      // The cloud accepts the row, then the local acknowledgement cannot commit.
      rawClient().exec(
        `CREATE TRIGGER fail_ack BEFORE DELETE ON sync_outbox
         BEGIN SELECT RAISE(ABORT, 'acknowledgement unavailable'); END;`,
      );

      const first = await push();

      expect(first.succeeded).toBe(1);
      expect(cloud.rows('account')).toHaveLength(1);
      // The crash left the work queued, which is safer than losing it.
      expect(countPendingSyncMutations()).toBe(1);

      rawClient().exec('DROP TRIGGER fail_ack');
      const second = await push();

      expect(second.status).toBe('success');
      expect(cloud.rows('account')).toHaveLength(1);
      expect(cloud.rowBySyncId('account', cash.syncId!)).toBeDefined();
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  describe('dependency ordering', () => {
    it('uploads an account before the expense that references it', async () => {
      const cash = makeAccount('Cash');
      addExpense(cash.id, 1200);

      await push();

      const order = cloud.calls.map((call) => call.entityType);
      expect(order.indexOf('account')).toBeLessThan(order.indexOf('transaction'));
      expect(cloud.rows('transaction')[0]).toMatchObject({
        source_account_sync_id: cash.syncId,
      });
    });

    it('uploads a custom category before the expense that uses it', async () => {
      const cash = makeAccount('Cash');
      const category = categoryService.createCategory({ name: 'Pets', type: 'expense' });
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: category.id,
        amountMinor: 900,
        title: 'Vet',
        paymentMode: 'cash',
        transactionDate: date,
      });

      await push();

      const order = cloud.calls.map((call) => call.entityType);
      expect(order.indexOf('category')).toBeLessThan(order.indexOf('transaction'));
      expect(cloud.rowBySyncId('transaction', expense.syncId!)).toMatchObject({
        category_sync_id: category.syncId,
      });
    });

    it('uploads a person before the lending record that references them', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const person = makePerson('Ram');
      const lend = transactionService.createLend({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 30000,
        transactionDate: date,
      });

      await push();

      const order = cloud.calls.map((call) => call.entityType);
      expect(order.indexOf('person')).toBeLessThan(order.indexOf('transaction'));
      expect(cloud.rowBySyncId('transaction', lend.syncId!)).toMatchObject({
        person_sync_id: person.syncId,
      });
    });

    it('fails a transaction safely when a parent identity cannot be resolved', async () => {
      const cash = makeAccount('Cash');
      const expense = addExpense(cash.id, 1200);
      await push();
      // Break the local mapping the way a corrupt database would.
      transactionService.updateExpense(expense.id, { amountMinor: 1500 });
      rawClient().prepare('UPDATE accounts SET sync_id = NULL WHERE id = ?').run(cash.id);

      const result = await push();

      expect(result.status).toBe('error');
      expect(result.failures[0]).toMatchObject({
        entityType: 'transaction',
        code: 'invalid_local_data',
        detail: 'unresolved_relation',
      });
      // No malformed row reached the cloud, and the work is still queued.
      expect(cloud.calls.filter((call) => call.entityType === 'transaction')).toHaveLength(1);
      expect(getPendingSyncMutation('transaction', expense.syncId!)).not.toBeNull();
    });
  });

  describe('tombstones and archiving', () => {
    it('uploads a deletion as a tombstone on the same cloud row', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const expense = addExpense(cash.id, 4000);
      await push();
      expect(cloud.rows('transaction')).toHaveLength(1);

      transactionService.deleteTransaction(expense.id);
      const result = await push();

      expect(result.status).toBe('success');
      const rows = cloud.rows('transaction');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sync_id: expense.syncId });
      expect(rows[0]!.deleted_at).toEqual(expect.any(Number));
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('uploads archiving as a normal update, never as a deletion', async () => {
      const cash = makeAccount('Cash');
      const person = makePerson('Ram');
      await push();

      accountService.archiveAccount(cash.id);
      personService.archivePerson(person.id);
      await push();

      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({
        is_archived: true,
        deleted_at: null,
      });
      expect(cloud.rowBySyncId('person', person.syncId!)).toMatchObject({
        is_archived: true,
        deleted_at: null,
      });
    });

    it('uploads nothing for a record created and deleted before it was ever linked', async () => {
      updateSyncState({ linkedUserId: null });
      const cash = makeAccount('Cash');
      const expense = addExpense(cash.id, 1000);
      transactionService.deleteTransaction(expense.id);
      updateSyncState({ linkedUserId: USER });

      await push();

      // The queue collapsed this locally, so push has no tombstone to invent.
      expect(cloud.rows('transaction')).toHaveLength(0);
      expect(cloud.rows('account')).toHaveLength(1);
    });
  });

  describe('failure handling', () => {
    it('keeps work queued and reports offline when the network fails', async () => {
      makeAccount('Cash');
      cloud.failWith(() => new PushRemoteError('network'));

      const result = await push();

      expect(result.status).toBe('offline');
      expect(result.failed).toBe(1);
      expect(countPendingSyncMutations()).toBe(1);
      const entry = listPendingSyncMutations()[0]!;
      expect(entry.attemptCount).toBe(1);
      expect(entry.lastError).toBe('network');
      expect(entry.lastAttemptAt).toBeInstanceOf(Date);
      expect(getSyncState()?.lastSyncError).toBe('network');
    });

    it('uploads successfully on the next run after a transient failure', async () => {
      const cash = makeAccount('Cash');
      cloud.failWith(failOnce(new PushRemoteError('network')));

      const first = await push();
      expect(first.status).toBe('offline');
      expect(countPendingSyncMutations()).toBe(1);

      const second = await push();

      expect(second.status).toBe('success');
      expect(cloud.rowBySyncId('account', cash.syncId!)).toBeDefined();
      expect(countPendingSyncMutations()).toBe(0);
      expect(getSyncState()?.lastSyncError).toBeNull();
    });

    it('reports an authorization rejection once instead of retrying in a loop', async () => {
      makeAccount('Cash');
      // A row the policy will not accept, as row level security rejects it.
      cloud.enforceOwner('someone-else');

      const result = await push();

      expect(result.status).toBe('error');
      expect(result.failures[0]).toMatchObject({ code: 'authorization', detail: '42501' });
      expect(cloud.calls).toHaveLength(1);
      expect(countPendingSyncMutations()).toBe(1);
      expect(listPendingSyncMutations()[0]!.attemptCount).toBe(1);
    });

    it('attributes a row-specific rejection without blocking its siblings', async () => {
      const cash = makeAccount('Cash');
      const bank = makeAccount('Bank');
      const wallet = makeAccount('Wallet');
      cloud.failWith((call) =>
        call.rows.length > 1 ||
        (call.rows as unknown as { sync_id: string }[])[0]!.sync_id === bank.syncId
          ? new PushRemoteError('constraint', '23505')
          : undefined,
      );

      const result = await push();

      // The batch failed atomically, so each row was retried to find the cause.
      expect(result.succeeded).toBe(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        entitySyncId: bank.syncId,
        code: 'constraint',
        detail: '23505',
      });
      expect(cloud.rowBySyncId('account', cash.syncId!)).toBeDefined();
      expect(cloud.rowBySyncId('account', wallet.syncId!)).toBeDefined();
      expect(cloud.rowBySyncId('account', bank.syncId!)).toBeUndefined();
      expect(countPendingSyncMutations()).toBe(1);
    });

    it('does not start a dependent phase after a parent failure', async () => {
      const cash = makeAccount('Cash');
      addExpense(cash.id, 1200);
      cloud.failWith((call) =>
        call.entityType === 'account' ? new PushRemoteError('constraint', '23514') : undefined,
      );

      const result = await push();

      expect(result.status).toBe('error');
      // Uploading the child would only be rejected by the remote foreign key.
      expect(cloud.calls.some((call) => call.entityType === 'transaction')).toBe(false);
      expect(countPendingSyncMutations()).toBe(2);
    });

    it('never removes queued work because the cloud rejected it', async () => {
      const cash = makeAccount('Cash');
      addExpense(cash.id, 1200);
      cloud.failWith(() => new PushRemoteError('remote_unknown', '500'));

      await push();
      await push();

      expect(countPendingSyncMutations()).toBe(2);
      expect(getPendingSyncMutation('account', cash.syncId!)).toMatchObject({ attemptCount: 2 });
    });
  });

  describe('local changes while a push is running', () => {
    it('keeps a newer edit queued when it lands during the upload', async () => {
      const cash = makeAccount('Cash');
      cloud.failWith((call) => {
        // The user renames the account while this exact row is in flight.
        if (call.entityType === 'account')
          accountService.updateAccount(cash.id, { name: 'Wallet' });
        return undefined;
      });

      const result = await push();

      expect(result.succeeded).toBe(1);
      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Cash' });
      // Acknowledgement must not erase the newer intent.
      expect(getPendingSyncMutation('account', cash.syncId!)).toMatchObject({
        operation: 'upsert',
      });

      cloud.failWith(null);
      await push();

      expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Wallet' });
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('keeps a deletion queued when it lands during the upload', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const expense = addExpense(cash.id, 4000);
      await push();
      transactionService.updateExpense(expense.id, { amountMinor: 4500 });

      cloud.failWith((call) => {
        if (call.entityType === 'transaction') transactionService.deleteTransaction(expense.id);
        return undefined;
      });
      const result = await push();

      expect(result.succeeded).toBe(1);
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
        operation: 'delete',
      });

      cloud.failWith(null);
      await push();

      const rows = cloud.rows('transaction');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deleted_at).toEqual(expect.any(Number));
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  describe('run bounds', () => {
    it('exposes a bounded batch size', () => {
      expect(PUSH_BATCH_SIZE).toBe(50);
    });

    it('continues across batches until the queue is empty', async () => {
      const cash = makeAccount('Cash', 'NPR', 10_000_000);
      for (let index = 0; index < 7; index += 1) addExpense(cash.id, 100 + index, `Item ${index}`);

      const result = await push({ batchSize: 2 });

      expect(result.succeeded).toBe(8);
      expect(cloud.rows('transaction')).toHaveLength(7);
      expect(countPendingSyncMutations()).toBe(0);
      expect(cloud.calls.length).toBeGreaterThan(2);
    });

    it('stops at the operation bound and leaves the rest queued', async () => {
      const cash = makeAccount('Cash', 'NPR', 10_000_000);
      for (let index = 0; index < 5; index += 1) addExpense(cash.id, 100 + index, `Item ${index}`);

      const result = await push({ batchSize: 2, maxOperations: 3 });

      expect(result.processed).toBeLessThanOrEqual(3);
      expect(countPendingSyncMutations()).toBeGreaterThan(0);
    });

    it('refuses to start a second engine while one is running', async () => {
      makeAccount('Cash');

      // The second call re-enters while the first run is still in flight.
      const [first, second] = await Promise.all([push(), push()]);

      const statuses = [first.status, second.status];
      expect(statuses).toContain('pushing');
      expect(statuses).toContain('success');
      expect(cloud.rows('account')).toHaveLength(1);
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  describe('offline first', () => {
    it('queues offline work and uploads it once a push is invoked', async () => {
      const cash = makeAccount('Cash', 'NPR', 1_000_000);
      const bank = makeAccount('Bank', 'NPR', 1_000_000);
      const person = makePerson('Ram');
      addExpense(cash.id, 1200);
      transactionService.createIncome({
        accountId: bank.id,
        categoryId: incomeCategory().id,
        amountMinor: 50000,
        title: 'Salary',
        paymentMode: 'bank_transfer',
        transactionDate: date,
      });
      transactionService.createTransfer({
        sourceAccountId: bank.id,
        destinationAccountId: cash.id,
        amountMinor: 10000,
        transactionDate: date,
      });
      transactionService.createLend({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 30000,
        transactionDate: date,
      });
      transactionService.createRepaymentReceived({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 10000,
        transactionDate: date,
      });

      // Everything works while the cloud is unreachable.
      cloud.failWith(() => new PushRemoteError('network'));
      expect((await push()).status).toBe('offline');
      expect(countPendingSyncMutations()).toBe(8);
      expect(transactionService.listTransactions()).toHaveLength(5);

      cloud.failWith(null);
      const result = await push();

      expect(result.status).toBe('success');
      expect(cloud.rows('transaction')).toHaveLength(5);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('uploads work queued before a restart', async () => {
      const cash = makeAccount('Cash', 'NPR', 1_000_000);
      const expense = addExpense(cash.id, 1200);

      reopenTestDatabase();
      migrateTestDatabase();
      updateSyncState({ linkedUserId: USER });

      const result = await push();

      expect(result.status).toBe('success');
      expect(cloud.rowBySyncId('transaction', expense.syncId!)).toBeDefined();
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  it('leaves local financial data untouched when the cloud rejects everything', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = addExpense(cash.id, 4000);
    const before = transactionService.getTransaction(expense.id);
    cloud.failWith(() => new PushRemoteError('constraint', '23514'));

    await push();

    expect(transactionService.getTransaction(expense.id)).toEqual(before);
    expect(accountService.getAccount(cash.id).name).toBe('Cash');
    expect(transactionService.listTransactions()).toHaveLength(1);
  });
});
