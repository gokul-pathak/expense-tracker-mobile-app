import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as settingsService from '@/features/settings/settings.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import {
  PUSH_BATCH_SIZE,
  PUSH_MAX_OPERATIONS_PER_RUN,
  pushPendingChanges,
} from '@/features/sync/push-sync.service';
import { PullRemoteError, PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import { listSyncConflicts } from '@/features/sync/sync-baseline.repository';
import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  getSyncState,
  listPendingSyncMutations,
  updateSyncState,
} from '@/features/sync/sync.repository';
import { syncNow } from '@/features/sync/sync.service';
import { createSyncId } from '@/features/sync/uuid';
import * as transactionService from '@/features/transactions/transaction.service';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';

import { cloudAccount, OTHER_USER, TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, makePerson, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient, reopenTestDatabase } from '../support/test-database';

/**
 * What happens under load, under repeated failure, and when the world changes
 * mid-run.
 *
 * These are the scenarios that decide whether sync is safe to release: a long
 * offline stretch, a queue far larger than one batch, a network that fails over
 * and over, a session that disappears halfway through. In every case the bar is
 * that nothing a person entered is lost and nothing they deleted comes back.
 */

const financialDate = new Date(2026, 0, 15);

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

function sync(userId: string = TEST_USER) {
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

describe('outbox durability under load', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('keeps more than a hundred queued mutations across a restart', async () => {
    const cash = makeAccount('Cash', 'NPR', 100_000_000);
    for (let index = 0; index < 120; index += 1) addExpense(cash.id, 100 + index, `Item ${index}`);
    const queued = countPendingSyncMutations();
    // One account plus 120 expenses. Seeding queues nothing: it is not a user
    // mutation.
    expect(queued).toBe(121);

    reopenTestDatabase();

    expect(countPendingSyncMutations()).toBe(queued);
    const result = await push();

    expect(result.status).toBe('success');
    expect(cloud.rows('transaction')).toHaveLength(120);
    expect(countPendingSyncMutations()).toBe(0);
    // Building 120 records through the domain services dominates the time here.
  }, 60_000);

  it('drains a thousand queued mutations across bounded runs', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000_000);
    for (let index = 0; index < 1000; index += 1) addExpense(cash.id, 100, `Item ${index}`);
    expect(countPendingSyncMutations()).toBe(1001);

    // Each run is deliberately bounded, so a large backlog converges over
    // several runs rather than in one unbounded burst.
    let runs = 0;
    while (countPendingSyncMutations() > 0 && runs < 10) {
      const result = await push();
      expect(result.status).toBe('success');
      expect(result.processed).toBeLessThanOrEqual(PUSH_MAX_OPERATIONS_PER_RUN);
      runs += 1;
    }

    expect(cloud.rows('transaction')).toHaveLength(1000);
    expect(countPendingSyncMutations()).toBe(0);
    expect(runs).toBeLessThanOrEqual(4);
    // Bounded requests too, not one enormous statement.
    const largest = Math.max(...cloud.calls.map((call) => call.rows.length));
    expect(largest).toBeLessThanOrEqual(PUSH_BATCH_SIZE);
    expect(verifySyncIntegrity().ok).toBe(true);
    // Building the fixture through the domain services dominates the time here;
    // the generous budget is for slow machines, not for the engine.
  }, 120_000);

  it('processes a large queue deterministically, parents before children', async () => {
    const cash = makeAccount('Cash', 'NPR', 100_000_000);
    for (let index = 0; index < 60; index += 1) addExpense(cash.id, 100, `Item ${index}`);

    await push();

    const order = cloud.calls.map((call) => call.entityType);
    expect(order.indexOf('account')).toBeLessThan(order.indexOf('transaction'));
  });

  it('survives a retry storm without losing or duplicating work', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    for (let index = 0; index < 20; index += 1) addExpense(cash.id, 500, `Item ${index}`);
    const queued = countPendingSyncMutations();
    cloud.failWith(() => new PushRemoteError('network'));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await push();
      expect(result.status).toBe('offline');
      expect(countPendingSyncMutations()).toBe(queued);
    }

    cloud.failWith(null);
    const recovered = await push();

    expect(recovered.status).toBe('success');
    expect(cloud.rows('transaction')).toHaveLength(20);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('records attempt metadata without ever discarding the work', async () => {
    const cash = makeAccount('Cash');
    cloud.failWith(() => new PushRemoteError('network'));

    await push();
    await push();
    await push();

    const entry = getPendingSyncMutation('account', cash.syncId!);
    expect(entry?.attemptCount).toBeGreaterThan(0);
    expect(entry?.lastError).toBe('network');
    // Compact classification only: no response body, no row values.
    expect(entry?.lastError?.length ?? 0).toBeLessThan(40);
  });

  it('does not advance the cursor through a pull retry storm', async () => {
    cloud.putRow('account', cloudAccount());
    cloud.failPullWith(() => new PullRemoteError('network'));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await pull();
      expect(result.status).toBe('offline');
      expect(getSyncState()?.pullCursor).toBeNull();
    }

    cloud.failPullWith(null);
    const recovered = await pull();

    expect(recovered.status).toBe('success');
    expect(accountService.listAccounts()).toHaveLength(1);
  });
});

describe('long offline use', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('converges a whole offline week of mixed activity on reconnect', async () => {
    const cash = makeAccount('Cash', 'NPR', 5_000_000);
    const bank = makeAccount('Bank', 'NPR', 10_000_000);
    const ram = makePerson('Ram');
    const coffee = categoryService.createCategory({ name: 'Coffee', type: 'expense' });

    const expenses = Array.from({ length: 15 }, (_, index) =>
      transactionService.createExpense({
        accountId: cash.id,
        categoryId: coffee.id,
        amountMinor: 1000 + index,
        title: `Coffee ${index}`,
        paymentMode: 'cash',
        transactionDate: financialDate,
      }),
    );
    transactionService.createIncome({
      accountId: bank.id,
      categoryId: categoryService.listIncomeCategories()[0]!.id,
      amountMinor: 6_500_000,
      title: 'Salary',
      paymentMode: 'bank_transfer',
      transactionDate: financialDate,
    });
    transactionService.createTransfer({
      sourceAccountId: bank.id,
      destinationAccountId: cash.id,
      amountMinor: 1_000_000,
      transactionDate: financialDate,
    });
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 800_000,
      transactionDate: financialDate,
    });
    transactionService.createRepaymentReceived({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 300_000,
      transactionDate: financialDate,
    });
    transactionService.updateExpense(expenses[0]!.id, { amountMinor: 2500 });
    transactionService.deleteTransaction(expenses[1]!.id);
    settingsService.updateDefaultCurrency('npr');

    const balanceBefore = getAccountBalance(cash.id);
    const totalBefore = getTotalBalance();

    const result = await sync();

    expect(result.status).toBe('success');
    expect(countPendingSyncMutations()).toBe(0);
    // Local figures are untouched by uploading them.
    expect(getAccountBalance(cash.id)).toBe(balanceBefore);
    expect(getTotalBalance()).toBe(totalBefore);
    // The deleted record travelled as a tombstone rather than vanishing.
    expect(cloud.rowBySyncId('transaction', expenses[1]!.syncId!)).toMatchObject({
      deleted_at: expect.any(Number),
    });
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('sends one operation per record however many times it was edited', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const expense = addExpense(cash.id, 1000);
    transactionService.updateExpense(expense.id, { amountMinor: 2000 });
    transactionService.updateExpense(expense.id, { amountMinor: 3000 });
    transactionService.updateExpense(expense.id, { amountMinor: 4000 });

    expect(countPendingSyncMutations()).toBe(2);
    await push();

    const uploads = cloud.calls
      .flatMap((call) => call.rows)
      .filter((row) => (row as { sync_id?: string }).sync_id === expense.syncId);
    expect(uploads).toHaveLength(1);
    expect(cloud.rowBySyncId('transaction', expense.syncId!)).toMatchObject({
      amount_minor: 4000,
    });
  });

  it('sends nothing at all for a record created and deleted before any link', async () => {
    updateSyncState({ linkedUserId: null });
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const expense = addExpense(cash.id, 1000);
    transactionService.deleteTransaction(expense.id);

    updateSyncState({ linkedUserId: TEST_USER });
    await push();

    // The cloud never knew this record, so there is nothing to tell it about.
    expect(cloud.rowBySyncId('transaction', expense.syncId!)).toBeUndefined();
    expect(cloud.rows('transaction')).toHaveLength(0);
  });
});

describe('identity hardening', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('refuses a duplicate global identity rather than reusing a row', () => {
    const cash = makeAccount('Cash');

    // A generator collision must fail the write, not silently merge records.
    expect(() =>
      rawClient()
        .prepare(
          'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('Collision', 'cash', 0, 'NPR', 0, Date.now(), Date.now(), cash.syncId!),
    ).toThrow();
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('generates distinct identities under repeated calls', () => {
    const identities = new Set(Array.from({ length: 500 }, () => createSyncId()));

    expect(identities.size).toBe(500);
  });

  it('keeps an identity stable through edits, archiving and synchronization', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const original = cash.syncId!;
    const expense = addExpense(cash.id, 5000);
    const expenseIdentity = expense.syncId!;

    accountService.updateAccount(cash.id, { name: 'Wallet' });
    accountService.archiveAccount(cash.id);
    accountService.unarchiveAccount(cash.id);
    transactionService.updateExpense(expense.id, { amountMinor: 6000 });
    await sync();
    reopenTestDatabase();

    expect(accountService.getAccount(cash.id).syncId).toBe(original);
    expect(transactionService.getTransaction(expense.id).syncId).toBe(expenseIdentity);
  });
});

describe('sync under changing conditions', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('runs a single cycle when several are requested at once', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);

    const results = await Promise.all([sync(), sync(), sync(), sync()]);

    expect(results.filter((result) => result.status === 'success')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'busy')).toHaveLength(3);
    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('stops safely when the session disappears mid-cycle', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    let calls = 0;

    const result = await syncNow({
      push: {
        dependencies: {
          // The session is valid for the upload, then gone.
          getAuthenticatedUserId: async () => (calls++ === 0 ? TEST_USER : null),
          createRemote: () => cloud.repository,
        },
      },
      pull: {
        dependencies: {
          getAuthenticatedUserId: async () => null,
          createRemote: () => cloud.pullRepository,
        },
      },
    });

    expect(result.status).toBe('auth_required');
    // Uploaded work stays uploaded; nothing local is deleted.
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(getSyncState()?.lastSuccessfulSyncAt).toBeNull();
  });

  it('stops before touching anything when the signed-in account changes mid-cycle', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await sync();
    const cloudRows = cloud.rows('transaction').length;

    addExpense(cash.id, 9000, 'After switch');
    const result = await sync(OTHER_USER);

    expect(result.status).toBe('account_mismatch');
    expect(cloud.rows('transaction')).toHaveLength(cloudRows);
    // The other account's queue is untouched and still this device's own.
    expect(countPendingSyncMutations()).toBe(1);
    expect(transactionService.listTransactions()).toHaveLength(2);
  });

  it('keeps working locally while the server is completely unavailable', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    cloud.failWith(() => new PushRemoteError('network'));
    cloud.failPullWith(() => new PullRemoteError('network'));

    for (let index = 0; index < 5; index += 1) {
      addExpense(cash.id, 1000, `Offline ${index}`);
      const result = await sync();
      expect(result.status).toBe('offline');
    }

    expect(transactionService.listTransactions()).toHaveLength(5);
    expect(getAccountBalance(cash.id)).toBe(995_000);
    expect(countPendingSyncMutations()).toBe(6);

    cloud.failWith(null);
    cloud.failPullWith(null);
    const recovered = await sync();

    expect(recovered.status).toBe('success');
    expect(cloud.rows('transaction')).toHaveLength(5);
    expect(countPendingSyncMutations()).toBe(0);
  });
});

describe('convergence guarantees', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  it('reaches a fixed point: repeated syncs change nothing further', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    await sync();

    const second = await sync();
    const third = await sync();

    for (const result of [second, third]) {
      expect(result.status).toBe('success');
      expect(result.pushed).toBe(0);
      expect(result.pulled).toBe(0);
      expect(result.conflicts).toBe(0);
      expect(result.pending).toBe(0);
    }
    expect(cloud.rows('transaction')).toHaveLength(1);
    expect(listSyncConflicts()).toHaveLength(0);
  });

  it('applies a repeated remote change exactly once', async () => {
    const remote = cloudAccount({ name: 'From another device' });
    cloud.putRow('account', remote);
    await pull();

    // The same row is re-announced several times.
    cloud.putRow('account', { ...remote });
    cloud.putRow('account', { ...remote });
    await pull();

    expect(accountService.listAccounts()).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().ok).toBe(true);
  });

  it('ignores a remote revision it has already accounted for', async () => {
    const remote = cloudAccount({ name: 'First' });
    cloud.putRow('account', remote);
    await pull();
    cloud.putRow('account', { ...remote, name: 'Second' });
    await pull();
    expect(accountService.listAccounts()[0]!.name).toBe('Second');

    // Replaying the whole feed must not walk the row backwards.
    updateSyncState({ pullCursor: 0 });
    const replay = await pull();

    expect(replay.status).toBe('idle');
    expect(accountService.listAccounts()[0]!.name).toBe('Second');
  });

  it('does not let a stale local edit undo a newer remote state after conflict', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    await sync();

    // Both sides move; the local side wins by resolving later on the server.
    const remote = cloud.rowBySyncId('account', cash.syncId!) as unknown as Record<string, unknown>;
    cloud.putRow('account', { ...remote, name: 'Remote edit' });
    accountService.updateAccount(cash.id, { name: 'Local edit' });

    await sync();
    await sync();
    await sync();

    expect(accountService.getAccount(cash.id).name).toBe('Local edit');
    expect(cloud.rowBySyncId('account', cash.syncId!)).toMatchObject({ name: 'Local edit' });
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('keeps a deletion deleted across repeated cycles', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = addExpense(cash.id, 5000);
    await sync();

    transactionService.deleteTransaction(expense.id);
    await sync();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await sync();
      expect(transactionService.listTransactions()).toHaveLength(0);
      expect(getAccountBalance(cash.id)).toBe(100000);
    }
    expect(cloud.rowBySyncId('transaction', expense.syncId!)).toMatchObject({
      deleted_at: expect.any(Number),
    });
  });

  it('never accumulates unresolved conflicts on a healthy device', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    for (let index = 0; index < 5; index += 1) {
      addExpense(cash.id, 100 + index, `Item ${index}`);
      await sync();
    }

    expect(listSyncConflicts()).toHaveLength(0);
    expect(countPendingSyncMutations()).toBe(0);
    expect(getSyncState()?.lastSyncError).toBeNull();
  });
});

describe('local integrity verifier', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
  });

  it('reports a clean bill of health for a normal database', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    addExpense(cash.id, 5000);
    makePerson('Ram');

    const report = verifySyncIntegrity();

    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.counts).toMatchObject({ accounts: 1, transactions: 1, people: 1 });
  });

  it('notices a row that lost its global identity', () => {
    makeAccount('Cash');
    rawClient().prepare('UPDATE accounts SET sync_id = NULL').run();

    const report = verifySyncIntegrity();

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      code: 'missing_sync_id',
      entityType: 'account',
      count: 1,
    });
  });

  it('notices queued work whose record no longer exists', () => {
    const cash = makeAccount('Cash');
    rawClient().prepare('DELETE FROM accounts WHERE sync_id = ?').run(cash.syncId!);

    const report = verifySyncIntegrity();

    expect(report.issues.map((issue) => issue.code)).toContain('outbox_orphaned');
  });

  it('notices a database that is both linked and mid-link', () => {
    updateSyncState({ linkedUserId: TEST_USER, pendingLinkUserId: OTHER_USER });

    const report = verifySyncIntegrity();

    expect(report.issues.map((issue) => issue.code)).toContain('sync_state_dual_binding');
  });

  it('notices a cursor left behind without a cloud account', () => {
    updateSyncState({ linkedUserId: null, pullCursor: 12 });

    const report = verifySyncIntegrity();

    expect(report.issues.map((issue) => issue.code)).toContain('sync_state_cursor_without_link');
  });

  it('reports codes and counts only, never financial values', () => {
    const cash = makeAccount('Secret account name', 'NPR', 123456);
    addExpense(cash.id, 98765, 'Private note');
    rawClient().prepare('UPDATE accounts SET sync_id = NULL').run();

    const serialized = JSON.stringify(verifySyncIntegrity().issues);

    expect(serialized).not.toContain('Secret account name');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('98765');
    expect(serialized).not.toContain('Private note');
  });

  it('reports without repairing anything', () => {
    makeAccount('Cash');
    rawClient().prepare('UPDATE accounts SET sync_id = NULL').run();

    verifySyncIntegrity();

    // A diagnostic that silently rewrote financial identity would be worse than
    // the problem it found.
    const stillBroken = verifySyncIntegrity();
    expect(stillBroken.issues.map((issue) => issue.code)).toContain('missing_sync_id');
    expect(listPendingSyncMutations()).toHaveLength(1);
  });
});
