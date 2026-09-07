import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import * as accountService from '@/features/accounts/account.service';
import { pullRemoteChanges, type PullSyncOptions } from '@/features/sync/pull-sync.service';
import { pushPendingChanges, type PushSyncOptions } from '@/features/sync/push-sync.service';
import { PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import { listSyncConflicts, readSyncBaseline } from '@/features/sync/sync-baseline.repository';
import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

const financialDate = new Date(2026, 0, 15);

let cloud: FakeCloud;

function push(options: PushSyncOptions = {}) {
  return pushPendingChanges({
    ...options,
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      ...options.dependencies,
    },
  });
}

function pull(options: PullSyncOptions = {}) {
  return pullRemoteChanges({
    ...options,
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.pullRepository,
      ...options.dependencies,
    },
  });
}

/** Another device's edit of a record that already exists in the cloud. */
function editRemotely(syncId: string, patch: Record<string, unknown>) {
  const current = cloud.rowBySyncId('account', syncId) as unknown as Record<string, unknown>;
  cloud.putRow('account', { ...current, ...patch });
}

/** A local account that both devices already know about, at a shared baseline. */
async function establishedAccount(name = 'Cash', openingBalanceMinor = 100000) {
  const account = makeAccount(name, 'NPR', openingBalanceMinor);
  await push();
  await pull();
  return account;
}

describe('pull conflict resolution', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  describe('detection', () => {
    it('treats a plain remote update as no conflict at all', async () => {
      const account = await establishedAccount();

      editRemotely(account.syncId!, { name: 'Renamed elsewhere' });
      const result = await pull();

      expect(result.status).toBe('success');
      expect(result.conflicted).toBe(0);
      expect(accountService.getAccount(account.id).name).toBe('Renamed elsewhere');
      expect(listSyncConflicts()).toHaveLength(0);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('does not overwrite a pending local edit with remote state it is already based on', async () => {
      const account = await establishedAccount();
      accountService.updateAccount(account.id, { name: 'Local edit' });

      // The device re-reads a change it has already accounted for, as a crash
      // before the cursor commit would make it do.
      updateSyncState({ pullCursor: 0 });
      const result = await pull();

      expect(result.conflicted).toBe(0);
      expect(accountService.getAccount(account.id).name).toBe('Local edit');
      expect(getPendingSyncMutation('account', account.syncId!)).toMatchObject({
        operation: 'upsert',
      });
      expect(listSyncConflicts()).toHaveLength(0);
    });

    it('does not call this device seeing its own upload a conflict', async () => {
      const account = makeAccount('Cash');
      // The cloud committed the row but the acknowledgement never arrived, so
      // the queue entry survives a crash exactly as M7D intends.
      cloud.failAfterWriteWith(() => new PushRemoteError('network'));
      await push();
      cloud.failAfterWriteWith(null);
      expect(getPendingSyncMutation('account', account.syncId!)).not.toBeNull();

      const result = await pull();

      expect(result.conflicted).toBe(0);
      expect(listSyncConflicts()).toHaveLength(0);
      expect(accountService.getAccount(account.id).name).toBe('Cash');
      // The queue entry stands until a push confirms it.
      expect(getPendingSyncMutation('account', account.syncId!)).not.toBeNull();
      expect(readSyncBaseline('account', account.syncId!)?.serverRevision).toBe(1);
    });
  });

  describe('two ordinary edits', () => {
    it('keeps the local edit, which resolves later on the server, and records the conflict', async () => {
      const account = await establishedAccount();

      // Both devices edit from the same baseline; the other device pushes first.
      editRemotely(account.syncId!, { name: 'Remote edit' });
      accountService.updateAccount(account.id, { name: 'Local edit' });

      const result = await pull();

      expect(result.status).toBe('conflict');
      expect(result.conflicts[0]).toMatchObject({
        entityType: 'account',
        entitySyncId: account.syncId,
        resolution: 'local_wins',
      });
      expect(accountService.getAccount(account.id).name).toBe('Local edit');
      // The winner is still queued, so the next push propagates it.
      expect(getPendingSyncMutation('account', account.syncId!)).toMatchObject({
        operation: 'upsert',
      });
    });

    it('does not re-detect the same remote revision as a conflict on every run', async () => {
      const account = await establishedAccount();
      editRemotely(account.syncId!, { name: 'Remote edit' });
      accountService.updateAccount(account.id, { name: 'Local edit' });
      await pull();

      updateSyncState({ pullCursor: 0 });
      const second = await pull();

      expect(second.conflicted).toBe(0);
      expect(listSyncConflicts()).toHaveLength(1);
      expect(accountService.getAccount(account.id).name).toBe('Local edit');
    });

    it('sends the local winner on the next push, converging both devices', async () => {
      const account = await establishedAccount();
      editRemotely(account.syncId!, { name: 'Remote edit' });
      accountService.updateAccount(account.id, { name: 'Local edit' });
      await pull();

      await push();

      expect(cloud.rowBySyncId('account', account.syncId!)).toMatchObject({ name: 'Local edit' });
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('records conflict metadata without copying the financial record', async () => {
      const account = await establishedAccount('Cash', 123456);
      editRemotely(account.syncId!, { name: 'Remote edit' });
      accountService.updateAccount(account.id, { name: 'Local edit' });

      await pull();

      const [conflict] = listSyncConflicts();
      expect(conflict).toMatchObject({
        entityType: 'account',
        entitySyncId: account.syncId,
        localOperation: 'upsert',
        baseServerRevision: 1,
        remoteServerRevision: 2,
        resolution: 'local_wins',
      });
      expect(JSON.stringify(conflict)).not.toContain('123456');
      expect(JSON.stringify(conflict)).not.toContain('Local edit');
    });
  });

  describe('delete wins', () => {
    it('lets a remote deletion win over a concurrent local edit', async () => {
      const account = await establishedAccount();
      accountService.updateAccount(account.id, { name: 'Local edit' });
      cloud.deleteRow('account', account.syncId!);

      const result = await pull();

      expect(result.conflicts[0]).toMatchObject({ resolution: 'remote_delete_wins' });
      // A record another device deleted does not come back because this one
      // edited it at the same time.
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(getPendingSyncMutation('account', account.syncId!)).toBeNull();
    });

    it('keeps a pending local deletion when a remote update arrives after it', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 5000,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: financialDate,
      });
      await push();
      await pull();

      transactionService.deleteTransaction(expense.id);
      const remote = cloud.rowBySyncId('transaction', expense.syncId!) as unknown as Record<
        string,
        unknown
      >;
      cloud.putRow('transaction', { ...remote, amount_minor: 9000 });

      const result = await pull();

      expect(result.conflicts[0]).toMatchObject({ resolution: 'local_delete_wins' });
      expect(transactionService.listTransactions()).toHaveLength(0);
      expect(getAccountBalance(cash.id)).toBe(100000);
      // The deletion is still queued, so the other device learns about it.
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
        operation: 'delete',
      });
    });

    it('converges when both devices deleted the same record', async () => {
      const account = await establishedAccount();
      accountService.archiveAccount(account.id);
      await push();
      await pull();

      cloud.deleteRow('account', account.syncId!);
      // The local database has no destructive account delete, so a transaction
      // stands in for the both-deleted case.
      const result = await pull();

      expect(result.conflicts).toHaveLength(0);
      expect(accountService.listAccounts()).toHaveLength(0);
    });

    it('converges when a transaction was deleted on both devices', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 5000,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: financialDate,
      });
      await push();
      await pull();

      transactionService.deleteTransaction(expense.id);
      cloud.deleteRow('transaction', expense.syncId!);

      const result = await pull();

      expect(result.conflicts[0]).toMatchObject({ resolution: 'converged_delete' });
      expect(transactionService.listTransactions()).toHaveLength(0);
      expect(getAccountBalance(cash.id)).toBe(100000);
      // Nothing is left to push: the cloud already holds the tombstone.
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toBeNull();
    });
  });

  describe('local changes made while a pull is in flight', () => {
    it('does not overwrite an edit made during the run', async () => {
      const account = await establishedAccount();
      editRemotely(account.syncId!, { name: 'Remote edit' });

      const result = await pull({
        dependencies: {
          createRemote: () => ({
            fetchChanges: cloud.pullRepository.fetchChanges,
            fetchRows: async (entityType, syncIds) => {
              const rows = await cloud.pullRepository.fetchRows(entityType, syncIds);
              // The user edits while the download is still in flight.
              accountService.updateAccount(account.id, { name: 'Edited mid-pull' });
              return rows;
            },
          }),
        },
      });

      expect(result.conflicts[0]).toMatchObject({ resolution: 'local_wins' });
      expect(accountService.getAccount(account.id).name).toBe('Edited mid-pull');
      expect(getPendingSyncMutation('account', account.syncId!)).toMatchObject({
        operation: 'upsert',
      });
    });

    it('does not resurrect a record deleted during the run', async () => {
      const cash = makeAccount('Cash', 'NPR', 100000);
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 5000,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: financialDate,
      });
      await push();
      await pull();
      const remote = cloud.rowBySyncId('transaction', expense.syncId!) as unknown as Record<
        string,
        unknown
      >;
      cloud.putRow('transaction', { ...remote, amount_minor: 9000 });

      await pull({
        dependencies: {
          createRemote: () => ({
            fetchChanges: cloud.pullRepository.fetchChanges,
            fetchRows: async (entityType, syncIds) => {
              const rows = await cloud.pullRepository.fetchRows(entityType, syncIds);
              if (entityType === 'transaction') transactionService.deleteTransaction(expense.id);
              return rows;
            },
          }),
        },
      });

      expect(transactionService.listTransactions()).toHaveLength(0);
      expect(getAccountBalance(cash.id)).toBe(100000);
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
        operation: 'delete',
      });
    });

    it('is not undone by an edit made while the tombstone was downloading', async () => {
      const account = await establishedAccount();
      accountService.updateAccount(account.id, { name: 'First local edit' });
      cloud.deleteRow('account', account.syncId!);

      await pull({
        dependencies: {
          createRemote: () => ({
            fetchChanges: cloud.pullRepository.fetchChanges,
            fetchRows: async (entityType, syncIds) => {
              const rows = await cloud.pullRepository.fetchRows(entityType, syncIds);
              // A newer local edit lands while the tombstone is downloading.
              accountService.updateAccount(account.id, { name: 'Newer local edit' });
              return rows;
            },
          }),
        },
      });

      expect(accountService.listAccounts()).toHaveLength(0);

      // Whatever is left queued, a push cannot bring the record back: the local
      // row now carries the tombstone, so that is what would be uploaded.
      await push();

      expect(cloud.rowBySyncId('account', account.syncId!)).toMatchObject({
        deleted_at: expect.any(Number),
      });
      const afterPull = await pull();
      expect(afterPull.status).not.toBe('error');
      expect(accountService.listAccounts()).toHaveLength(0);
    });
  });

  describe('engine separation', () => {
    it('never writes to the cloud while pulling', async () => {
      const account = await establishedAccount();
      editRemotely(account.syncId!, { name: 'Remote edit' });
      accountService.updateAccount(account.id, { name: 'Local edit' });
      const uploadsBefore = cloud.calls.length;

      await pull();

      // A conflict the local side wins stays queued for a push; pull resolves
      // nothing by calling Supabase itself.
      expect(cloud.calls).toHaveLength(uploadsBefore);
      expect(cloud.rowBySyncId('account', account.syncId!)).toMatchObject({ name: 'Remote edit' });
    });

    it('does not let push and pull run at the same time', async () => {
      makeAccount('Cash');

      const [pushed, pulled] = await Promise.all([push(), pull()]);

      expect([pushed.status, pulled.status]).toContain('pulling');
      expect(getSyncState()?.linkedUserId).toBe(TEST_USER);
    });
  });
});
