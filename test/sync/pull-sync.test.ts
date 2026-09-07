import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

/** Lets one test simulate a failure part-way through applying a batch. */
const applyControl = vi.hoisted(() => ({ failAccountApply: false }));

vi.mock('@/features/sync/remote-apply.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sync/remote-apply.repository')>();
  return {
    ...actual,
    applyRemoteAccount: (...args: Parameters<typeof actual.applyRemoteAccount>) => {
      if (applyControl.failAccountApply) throw new Error('simulated failure while applying');
      return actual.applyRemoteAccount(...args);
    },
  };
});

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import * as reportsService from '@/features/reports/reports.service';
import * as settingsService from '@/features/settings/settings.service';
import {
  PULL_BATCH_SIZE,
  pullRemoteChanges,
  type PullSyncOptions,
} from '@/features/sync/pull-sync.service';
import { PullRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import {
  clearSyncBaselines,
  hasRemoteTombstone,
  listSyncConflicts,
  readSyncBaseline,
} from '@/features/sync/sync-baseline.repository';
import {
  countPendingSyncMutations,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
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
  cloudSyncId,
  cloudTransaction,
  OTHER_USER,
  TEST_USER,
} from '../support/cloud-rows';
import { setupDatabase } from '../support/domain';
import { createFakeCloud, failPullOnce, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient, reopenTestDatabase } from '../support/test-database';

const financialDate = new Date(2026, 0, 15).getTime();

let cloud: FakeCloud;

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

/** A cloud that already holds one account and one custom expense category. */
function seedCloudParents() {
  const account = cloudAccount({ name: 'Cloud Cash', opening_balance_minor: 100000 });
  const category = cloudCategory({ name: 'Cloud Food' });
  const person = cloudPerson({ name: 'Ram' });
  cloud.putRow('account', account);
  cloud.putRow('category', category);
  cloud.putRow('person', person);
  return { account, category, person };
}

describe('pull sync engine', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    applyControl.failAccountApply = false;
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  describe('eligibility', () => {
    it('does nothing when this build has no cloud configuration', async () => {
      const result = await pull({ dependencies: { createRemote: () => null } });

      expect(result.status).toBe('unavailable');
      expect(cloud.pullCalls).toHaveLength(0);
    });

    it('does nothing while signed out', async () => {
      cloud.putRow('account', cloudAccount());

      const result = await pull({ dependencies: { getAuthenticatedUserId: async () => null } });

      expect(result.status).toBe('auth_required');
      expect(cloud.pullCalls).toHaveLength(0);
      expect(accountService.listAccounts()).toHaveLength(0);
    });

    it('refuses to download into a database that is not linked to the account', async () => {
      updateSyncState({ linkedUserId: null });
      cloud.putRow('account', cloudAccount());

      const result = await pull();

      // Signing in is not consent to merge a stranger's cloud data into this
      // local database. Linking is a deliberate act, and it is M7F's job.
      expect(result.status).toBe('not_linked');
      expect(cloud.pullCalls).toHaveLength(0);
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(getSyncState()?.pullCursor).toBeNull();
    });

    it('refuses when a different account is signed in, and does not relink', async () => {
      cloud.putRow('account', cloudAccount());

      const result = await pull({
        dependencies: { getAuthenticatedUserId: async () => OTHER_USER },
      });

      expect(result.status).toBe('account_mismatch');
      expect(cloud.pullCalls).toHaveLength(0);
      expect(getSyncState()?.linkedUserId).toBe(TEST_USER);
      expect(accountService.listAccounts()).toHaveLength(0);
    });

    it('reports nothing to do on an empty change feed', async () => {
      const result = await pull();

      expect(result).toMatchObject({ status: 'idle', received: 0, applied: 0 });
      expect(getSyncState()?.lastSuccessfulPullAt).toBeInstanceOf(Date);
    });
  });

  describe('remote inserts', () => {
    it('creates a remote account with its cloud identity and queues nothing', async () => {
      const remote = cloudAccount({ name: 'Bank', type: 'bank', opening_balance_minor: 250000 });
      cloud.putRow('account', remote);

      const result = await pull();

      const [account] = accountService.listAccounts();
      expect(result).toMatchObject({ status: 'success', applied: 1, cursorAdvanced: true });
      expect(account).toMatchObject({
        name: 'Bank',
        type: 'bank',
        openingBalanceMinor: 250000,
        syncId: remote.sync_id,
      });
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('creates a remote custom category with its own type and identity', async () => {
      const before = categoryService.listCategories().length;
      const remote = cloudCategory({ name: 'Coffee', type: 'expense' });
      cloud.putRow('category', remote);

      await pull();

      const category = categoryService
        .listCategories()
        .find((candidate) => candidate.syncId === remote.sync_id);
      expect(category).toMatchObject({ name: 'Coffee', type: 'expense', systemKey: null });
      expect(categoryService.listCategories()).toHaveLength(before + 1);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('creates a remote person without inventing derived financial values', async () => {
      const remote = cloudPerson({ name: 'Sita', note: 'Neighbour' });
      cloud.putRow('person', remote);

      await pull();

      const [person] = personService.listPeople();
      expect(person).toMatchObject({ name: 'Sita', note: 'Neighbour', syncId: remote.sync_id });
      const summary = transactionService.getPersonFinancialSummary(person!.id);
      expect(summary).toMatchObject({ receivableMinor: 0, liabilityMinor: 0, status: 'settled' });
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('updates the settings singleton instead of adding a second row', async () => {
      cloud.putRow('settings', cloudSettings({ default_currency: 'USD' }));

      await pull();

      expect(settingsService.getAppSettings().defaultCurrency).toBe('USD');
      expect(countSettingsRows()).toBe(1);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('reconciles a built-in category by system key instead of duplicating it', async () => {
      const local = categoryService
        .listExpenseCategories()
        .find((category) => category.systemKey === 'expense_food')!;
      const before = categoryService.listCategories().length;
      const remote = cloudCategory({
        name: 'Food',
        type: 'expense',
        system_key: 'expense_food',
        is_default: true,
      });
      cloud.putRow('category', remote);

      await pull();

      const reconciled = categoryService.getCategory(local.id);
      expect(reconciled.syncId).toBe(remote.sync_id);
      expect(categoryService.listCategories()).toHaveLength(before);
      // The rebinding is recorded rather than done silently.
      expect(listSyncConflicts()[0]).toMatchObject({
        entityType: 'category',
        resolution: 'remote_wins',
        detail: 'system_key_rebind',
      });
    });
  });

  describe('remote updates', () => {
    it('applies a remote rename and preserves the remote domain timestamp', async () => {
      const remote = cloudAccount({ name: 'Cash' });
      cloud.putRow('account', remote);
      await pull();

      cloud.putRow('account', { ...remote, name: 'Wallet', updated_at: financialDate });
      const result = await pull();

      const [account] = accountService.listAccounts();
      expect(result.status).toBe('success');
      expect(account).toMatchObject({ name: 'Wallet' });
      expect(account!.updatedAt.getTime()).toBe(financialDate);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('applies a remote archive as archive, keeping the account and its history', async () => {
      const { account, category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
          amount_minor: 5000,
        }),
      );
      await pull();

      cloud.putRow('account', { ...account, is_archived: true });
      await pull();

      const stored = accountService.listAccounts()[0]!;
      expect(stored.isArchived).toBe(true);
      expect(accountService.listArchivedAccounts()).toHaveLength(1);
      expect(transactionService.listTransactions()).toHaveLength(1);
      expect(getAccountBalance(stored.id)).toBe(95000);
    });

    it('applies a remote unarchive', async () => {
      const account = cloudAccount({ is_archived: true });
      cloud.putRow('account', account);
      await pull();
      expect(accountService.listActiveAccounts()).toHaveLength(0);

      cloud.putRow('account', { ...account, is_archived: false });
      await pull();

      expect(accountService.listActiveAccounts()).toHaveLength(1);
      expect(countPendingSyncMutations()).toBe(0);
    });
  });

  describe('transaction semantics', () => {
    it('applies a remote expense, moving the balance and the reports with it', async () => {
      const { account, category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'expense',
          amount_minor: 5000,
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
          payment_mode: 'cash',
          transaction_date: financialDate,
        }),
      );

      const result = await pull();

      const stored = transactionService.listTransactions();
      expect(result.status).toBe('success');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ type: 'expense', amountMinor: 5000, currency: 'NPR' });
      const localAccount = accountService.listAccounts()[0]!;
      expect(getAccountBalance(localAccount.id)).toBe(95000);
      expect(expenseInMonth(financialDate)).toBe(5000);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('applies a remote income to the destination account', async () => {
      const account = cloudAccount({ opening_balance_minor: 0 });
      const category = cloudCategory({ name: 'Salary', type: 'income' });
      cloud.putRow('account', account);
      cloud.putRow('category', category);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'income',
          amount_minor: 120000,
          category_sync_id: category.sync_id,
          destination_account_sync_id: account.sync_id,
          transaction_date: financialDate,
        }),
      );

      await pull();

      const localAccount = accountService.listAccounts()[0]!;
      expect(getAccountBalance(localAccount.id)).toBe(120000);
      expect(incomeInMonth(financialDate)).toBe(120000);
    });

    it('applies a remote transfer as one transfer that leaves the total unchanged', async () => {
      const bank = cloudAccount({ name: 'Bank', opening_balance_minor: 200000 });
      const wallet = cloudAccount({ name: 'Wallet', opening_balance_minor: 0 });
      cloud.putRow('account', bank);
      cloud.putRow('account', wallet);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'transfer',
          amount_minor: 5000,
          source_account_sync_id: bank.sync_id,
          destination_account_sync_id: wallet.sync_id,
          title: 'Transfer',
          transaction_date: financialDate,
        }),
      );

      await pull();

      const accounts = accountService.listAccounts();
      const localBank = accounts.find((account) => account.name === 'Bank')!;
      const localWallet = accounts.find((account) => account.name === 'Wallet')!;
      expect(transactionService.listTransactions()).toHaveLength(1);
      expect(transactionService.listTransactions()[0]!.type).toBe('transfer');
      expect(getAccountBalance(localBank.id)).toBe(195000);
      expect(getAccountBalance(localWallet.id)).toBe(5000);
      expect(getTotalBalance()).toBe(200000);
      expect(incomeInMonth(financialDate)).toBe(0);
      expect(expenseInMonth(financialDate)).toBe(0);
    });

    it('applies a remote lend as a receivable, not an expense', async () => {
      const { account, person } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'lend',
          amount_minor: 30000,
          source_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Lend',
          transaction_date: financialDate,
        }),
      );

      await pull();

      const localAccount = accountService.listAccounts()[0]!;
      const localPerson = personService.listPeople()[0]!;
      expect(getAccountBalance(localAccount.id)).toBe(70000);
      expect(transactionService.getPersonFinancialSummary(localPerson.id)).toMatchObject({
        receivableMinor: 30000,
        liabilityMinor: 0,
      });
      expect(expenseInMonth(financialDate)).toBe(0);
    });

    it('applies a remote borrow as a liability, not income', async () => {
      const { account, person } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'borrow',
          amount_minor: 40000,
          destination_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Borrow',
          transaction_date: financialDate,
        }),
      );

      await pull();

      const localAccount = accountService.listAccounts()[0]!;
      const localPerson = personService.listPeople()[0]!;
      expect(getAccountBalance(localAccount.id)).toBe(140000);
      expect(transactionService.getPersonFinancialSummary(localPerson.id)).toMatchObject({
        receivableMinor: 0,
        liabilityMinor: 40000,
      });
      expect(incomeInMonth(financialDate)).toBe(0);
    });

    it('applies a lend and its repayment that arrive in the same batch', async () => {
      const { account, person } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'lend',
          amount_minor: 30000,
          source_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Lend',
        }),
      );
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'repayment_received',
          amount_minor: 10000,
          destination_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Repayment received',
        }),
      );

      const result = await pull();

      const localPerson = personService.listPeople()[0]!;
      expect(result.status).toBe('success');
      expect(transactionService.getPersonFinancialSummary(localPerson.id)).toMatchObject({
        receivableMinor: 20000,
        status: 'partially_paid',
      });
      expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(80000);
    });

    it('applies a backdated remote transaction to the month it belongs to', async () => {
      const { account, category } = seedCloudParents();
      const lastMonth = new Date(2025, 11, 20).getTime();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          amount_minor: 7000,
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
          transaction_date: lastMonth,
          // Written now, but dated in a previous month.
          created_at: financialDate,
          updated_at: financialDate,
        }),
      );

      await pull();

      expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(93000);
      expect(expenseInMonth(lastMonth)).toBe(7000);
      expect(expenseInMonth(financialDate)).toBe(0);
    });

    it('applies parents before the transaction that depends on them', async () => {
      const account = cloudAccount({ opening_balance_minor: 50000 });
      const category = cloudCategory({ name: 'Bills' });
      const person = cloudPerson();
      cloud.putRow('account', account);
      cloud.putRow('category', category);
      cloud.putRow('person', person);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          amount_minor: 1000,
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
        }),
      );
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'lend',
          amount_minor: 2000,
          source_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Lend',
        }),
      );

      const result = await pull();

      expect(result).toMatchObject({ status: 'success', applied: 5 });
      expect(transactionService.listTransactions()).toHaveLength(2);
      expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(47000);
    });
  });

  describe('tombstones', () => {
    it('hides a remotely deleted expense and restores the balance', async () => {
      const { account, category } = seedCloudParents();
      const expense = cloudTransaction({
        amount_minor: 5000,
        category_sync_id: category.sync_id,
        source_account_sync_id: account.sync_id,
        transaction_date: financialDate,
      });
      cloud.putRow('transaction', expense);
      await pull();
      const localAccount = accountService.listAccounts()[0]!;
      expect(getAccountBalance(localAccount.id)).toBe(95000);

      cloud.deleteRow('transaction', expense.sync_id);
      const result = await pull();

      expect(result).toMatchObject({ status: 'success', deleted: 1 });
      expect(transactionService.listTransactions()).toHaveLength(0);
      expect(getAccountBalance(localAccount.id)).toBe(100000);
      expect(expenseInMonth(financialDate)).toBe(0);
      expect(getDashboardSummary({ now: new Date(financialDate) }).monthlyExpenseMinor).toBe(0);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('restores both sides of a remotely deleted transfer', async () => {
      const bank = cloudAccount({ name: 'Bank', opening_balance_minor: 200000 });
      const wallet = cloudAccount({ name: 'Wallet' });
      cloud.putRow('account', bank);
      cloud.putRow('account', wallet);
      const transfer = cloudTransaction({
        type: 'transfer',
        amount_minor: 5000,
        source_account_sync_id: bank.sync_id,
        destination_account_sync_id: wallet.sync_id,
        title: 'Transfer',
      });
      cloud.putRow('transaction', transfer);
      await pull();

      cloud.deleteRow('transaction', transfer.sync_id);
      await pull();

      const accounts = accountService.listAccounts();
      expect(getAccountBalance(accounts.find((a) => a.name === 'Bank')!.id)).toBe(200000);
      expect(getAccountBalance(accounts.find((a) => a.name === 'Wallet')!.id)).toBe(0);
      expect(getTotalBalance()).toBe(200000);
    });

    it('removes a remotely deleted repayment without breaking the debt history', async () => {
      const { account, person } = seedCloudParents();
      const lend = cloudTransaction({
        type: 'lend',
        amount_minor: 30000,
        source_account_sync_id: account.sync_id,
        person_sync_id: person.sync_id,
        title: 'Lend',
      });
      const repayment = cloudTransaction({
        type: 'repayment_received',
        amount_minor: 10000,
        destination_account_sync_id: account.sync_id,
        person_sync_id: person.sync_id,
        title: 'Repayment received',
      });
      cloud.putRow('transaction', lend);
      cloud.putRow('transaction', repayment);
      await pull();

      cloud.deleteRow('transaction', repayment.sync_id);
      await pull();

      const localPerson = personService.listPeople()[0]!;
      expect(transactionService.getPersonFinancialSummary(localPerson.id)).toMatchObject({
        receivableMinor: 30000,
        status: 'pending',
      });
    });

    it('remembers a tombstone for a record this device never had', async () => {
      const account = cloudAccount();
      cloud.putRow('account', account);
      cloud.deleteRow('account', account.sync_id);
      // The insert and the deletion arrive together, so the row was never local.
      const result = await pull();

      expect(result.status).toBe('success');
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(hasRemoteTombstone('account', account.sync_id)).toBe(true);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('refuses a tombstone for the settings singleton rather than break the app', async () => {
      const settings = cloudSettings({ default_currency: 'USD' });
      cloud.putRow('settings', settings);
      await pull();
      cloud.deleteRow('settings', settings.sync_id);

      const result = await pull();

      expect(result.status).toBe('attention_required');
      expect(result.failures[0]).toMatchObject({
        code: 'unsupported_remote_data',
        detail: 'settings_tombstone',
      });
      expect(settingsService.getAppSettings().defaultCurrency).toBe('USD');
    });
  });

  describe('cursor', () => {
    it('advances only over changes it applied', async () => {
      cloud.putRow('account', cloudAccount());
      const result = await pull();

      const lastChange = cloud.changes().at(-1)!;
      expect(result.cursor).toBe(lastChange.sequence);
      expect(getSyncState()?.pullCursor).toBe(lastChange.sequence);
    });

    it('processes only newer changes on the next run', async () => {
      cloud.putRow('account', cloudAccount({ name: 'First' }));
      await pull();
      const cursorAfterFirst = getSyncState()?.pullCursor;

      cloud.putRow('account', cloudAccount({ name: 'Second' }));
      const result = await pull();

      expect(result.applied).toBe(1);
      expect(getSyncState()!.pullCursor!).toBeGreaterThan(cursorAfterFirst!);
      expect(accountService.listAccounts()).toHaveLength(2);
    });

    it('leaves the cursor and the database untouched when the network fails', async () => {
      cloud.putRow('account', cloudAccount());
      await pull();
      const cursor = getSyncState()?.pullCursor;
      cloud.putRow('account', cloudAccount({ name: 'Unreachable' }));

      cloud.failPullWith(() => new PullRemoteError('network'));
      const result = await pull();

      expect(result.status).toBe('offline');
      expect(getSyncState()?.pullCursor).toBe(cursor);
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('stops without losing progress when the session expires mid-run', async () => {
      cloud.putRow('account', cloudAccount({ name: 'First' }));
      await pull();
      const cursor = getSyncState()!.pullCursor!;
      cloud.putRow('account', cloudAccount({ name: 'Second' }));

      cloud.failPullWith(() => new PullRemoteError('auth', 'PGRST301'));
      const result = await pull();

      expect(result.status).toBe('auth_required');
      expect(getSyncState()?.pullCursor).toBe(cursor);
      expect(accountService.listAccounts()).toHaveLength(1);
    });

    it('surfaces an authorization refusal instead of working around it', async () => {
      cloud.putRow('account', cloudAccount());
      cloud.failPullWith(() => new PullRemoteError('authorization', '42501'));

      const result = await pull();

      expect(result.status).toBe('error');
      expect(result.failures[0]?.code).toBe('authorization');
      expect(getSyncState()?.pullCursor).toBeNull();
    });

    it('recovers on the next run after a transient failure', async () => {
      cloud.putRow('account', cloudAccount());
      cloud.failPullWith(failPullOnce(new PullRemoteError('network')));

      expect((await pull()).status).toBe('offline');
      const result = await pull();

      expect(result.status).toBe('success');
      expect(accountService.listAccounts()).toHaveLength(1);
    });

    it('starts from the beginning of history when no cursor exists yet', async () => {
      cloud.putRow('account', cloudAccount({ name: 'Historic' }));
      expect(getSyncState()?.pullCursor).toBeNull();

      const result = await pull();

      // An absent cursor means "nothing applied yet", never "already up to date".
      expect(result.applied).toBe(1);
      expect(accountService.listAccounts()).toHaveLength(1);
    });
  });

  describe('batching', () => {
    it('uses a bounded batch size', () => {
      expect(PULL_BATCH_SIZE).toBe(100);
    });

    it('continues across pages until it is caught up', async () => {
      for (let index = 0; index < 7; index += 1) {
        cloud.putRow('account', cloudAccount({ name: `Account ${index}` }));
      }

      const result = await pull({ batchSize: 2 });

      expect(result.applied).toBe(7);
      expect(result.batches).toBeGreaterThan(3);
      expect(accountService.listAccounts()).toHaveLength(7);
    });

    it('stops at the run bound and resumes from the same cursor', async () => {
      for (let index = 0; index < 6; index += 1) {
        cloud.putRow('account', cloudAccount({ name: `Account ${index}` }));
      }

      const first = await pull({ batchSize: 2, maxBatches: 2 });
      expect(accountService.listAccounts()).toHaveLength(4);

      const second = await pull({ batchSize: 2 });
      expect(second.cursor).toBeGreaterThan(first.cursor!);
      expect(accountService.listAccounts()).toHaveLength(6);
    });

    it('cannot skip records that share a wall-clock instant', async () => {
      // Ordering is a server sequence, not a timestamp, so rows written in the
      // same millisecond still have distinct, total positions.
      for (let index = 0; index < 5; index += 1) {
        cloud.putRow('account', cloudAccount({ name: `Same instant ${index}` }));
      }
      const instants = new Set(
        cloud
          .changes()
          .map((change) => change.sequence)
          .map(String),
      );
      expect(instants.size).toBe(5);

      const result = await pull({ batchSize: 1 });

      expect(result.applied).toBe(5);
      expect(accountService.listAccounts()).toHaveLength(5);
    });

    it('leaves the cursor alone when fetching the rows of a batch fails', async () => {
      cloud.putRow('account', cloudAccount());
      cloud.failPullWith((call) =>
        call.kind === 'rows' ? new PullRemoteError('network') : undefined,
      );

      const result = await pull();

      expect(result.status).toBe('offline');
      expect(getSyncState()?.pullCursor).toBeNull();
      expect(accountService.listAccounts()).toHaveLength(0);
    });

    it('picks up a row that appeared while an earlier batch was being applied', async () => {
      cloud.putRow('account', cloudAccount({ name: 'Before' }));
      await pull();

      cloud.putRow('account', cloudAccount({ name: 'After' }));
      const result = await pull();

      expect(result.applied).toBe(1);
      expect(accountService.listAccounts().map((account) => account.name)).toEqual([
        'Before',
        'After',
      ]);
    });

    it('collapses repeated changes for one record into a single application', async () => {
      const account = cloudAccount({ name: 'First' });
      cloud.putRow('account', account);
      cloud.putRow('account', { ...account, name: 'Second' });
      cloud.putRow('account', { ...account, name: 'Third' });

      const result = await pull();

      // The upsert trigger appends more change rows than there are records.
      expect(result.received).toBeGreaterThan(1);
      expect(result.applied).toBe(1);
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(accountService.listAccounts()[0]!.name).toBe('Third');
    });
  });

  describe('untrusted remote data', () => {
    it('refuses a row owned by another user', async () => {
      cloud.putRow('account', cloudAccount({ user_id: OTHER_USER, name: 'Someone else' }));

      const result = await pull();

      expect(result.status).toBe('attention_required');
      expect(result.failures[0]?.code).toBe('foreign_owner');
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(getSyncState()?.pullCursor).toBeNull();
    });

    it('refuses an amount that cannot be represented exactly', async () => {
      const { account, category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          amount_minor: '9007199254740993',
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
        }),
      );

      const result = await pull();

      expect(result.status).toBe('attention_required');
      expect(result.failures[0]).toMatchObject({
        code: 'invalid_remote_data',
        detail: 'amount_minor',
      });
      expect(transactionService.listTransactions()).toHaveLength(0);
    });

    it('accepts a bigint sent as a string, exactly', async () => {
      cloud.putRow('account', cloudAccount({ opening_balance_minor: '123456789' }));

      await pull();

      expect(accountService.listAccounts()[0]!.openingBalanceMinor).toBe(123456789);
    });

    it('refuses an expense filed under an income category', async () => {
      const account = cloudAccount({ opening_balance_minor: 100000 });
      const income = cloudCategory({ name: 'Salary', type: 'income' });
      cloud.putRow('account', account);
      cloud.putRow('category', income);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'expense',
          category_sync_id: income.sync_id,
          source_account_sync_id: account.sync_id,
        }),
      );

      const result = await pull();

      expect(result.status).toBe('attention_required');
      expect(result.failures[0]).toMatchObject({
        code: 'invalid_remote_data',
        detail: 'category_type',
      });
      expect(transactionService.listTransactions()).toHaveLength(0);
      // The parents before the bad row still applied; the cursor stops at them.
      expect(accountService.listAccounts()).toHaveLength(1);
    });

    it('refuses a transfer whose source and destination are the same account', async () => {
      const account = cloudAccount();
      cloud.putRow('account', account);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'transfer',
          source_account_sync_id: account.sync_id,
          destination_account_sync_id: account.sync_id,
          title: 'Transfer',
        }),
      );

      const result = await pull();

      expect(result.failures[0]).toMatchObject({ detail: 'transfer_same_account' });
      expect(transactionService.listTransactions()).toHaveLength(0);
    });

    it('refuses a transaction whose parent is nowhere to be found', async () => {
      const { category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          category_sync_id: category.sync_id,
          source_account_sync_id: cloudSyncId(),
        }),
      );

      const result = await pull();

      expect(result.failures[0]).toMatchObject({ code: 'unknown_parent', detail: 'account' });
      // A missing parent never becomes a null foreign key.
      expect(transactionService.listTransactions()).toHaveLength(0);
    });

    it('refuses a remote batch that would overpay a debt', async () => {
      const { account, person } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'lend',
          amount_minor: 10000,
          source_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Lend',
        }),
      );
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'repayment_received',
          amount_minor: 25000,
          destination_account_sync_id: account.sync_id,
          person_sync_id: person.sync_id,
          title: 'Repayment received',
        }),
      );

      const result = await pull();

      expect(result.status).toBe('attention_required');
      expect(result.failures[0]).toMatchObject({
        code: 'domain_invariant',
        detail: 'repayment_received_exceeds_lent',
      });
      const localPerson = personService.listPeople()[0]!;
      expect(transactionService.getPersonFinancialSummary(localPerson.id).receivableMinor).toBe(
        10000,
      );
    });

    it('refuses a transaction type the app has no domain support for', async () => {
      const account = cloudAccount();
      cloud.putRow('account', account);
      cloud.putRow(
        'transaction',
        cloudTransaction({
          type: 'investment',
          source_account_sync_id: account.sync_id,
          title: 'Investment',
        }),
      );

      const result = await pull();

      expect(result.failures[0]?.code).toBe('unsupported_remote_data');
      expect(transactionService.listTransactions()).toHaveLength(0);
    });

    it('does not step the cursor over a record it refused', async () => {
      cloud.putRow('account', cloudAccount({ name: 'Good' }));
      const cursorBeforeBadRow = cloud.changes().at(-1)!.sequence;
      cloud.putRow('account', cloudAccount({ user_id: OTHER_USER, name: 'Foreign' }));
      cloud.putRow('account', cloudAccount({ name: 'Later' }));

      const result = await pull();

      expect(result.cursor).toBe(cursorBeforeBadRow);
      expect(accountService.listAccounts().map((account) => account.name)).toEqual(['Good']);

      // A second run makes no further progress: nothing is silently skipped.
      const second = await pull();
      expect(second.cursor).toBe(cursorBeforeBadRow);
      expect(second.status).toBe('attention_required');
    });
  });

  describe('idempotency and crash safety', () => {
    it('reaches the same local state when the same batch is applied twice', async () => {
      const { account, category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          amount_minor: 5000,
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
        }),
      );
      await pull();
      const balanceAfterFirst = getAccountBalance(accountService.listAccounts()[0]!.id);

      // A crash between applying and acknowledging would leave the cursor behind.
      updateSyncState({ pullCursor: 0 });
      const replay = await pull();

      // The device already accounted for these revisions, so the replay writes
      // nothing at all, and the local state is exactly what it was.
      expect(replay.status).toBe('idle');
      expect(transactionService.listTransactions()).toHaveLength(1);
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(
        categoryService.listCategories().filter((c) => c.syncId === category.sync_id),
      ).toHaveLength(1);
      expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(balanceAfterFirst);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('re-applies the same rows without duplicating anything when its bookkeeping is lost', async () => {
      const { account, category } = seedCloudParents();
      cloud.putRow(
        'transaction',
        cloudTransaction({
          amount_minor: 5000,
          category_sync_id: category.sync_id,
          source_account_sync_id: account.sync_id,
        }),
      );
      await pull();
      const balanceAfterFirst = getAccountBalance(accountService.listAccounts()[0]!.id);
      const categoryCount = categoryService.listCategories().length;

      // The harshest replay: the cursor and every per-record baseline are gone,
      // so the engine reprocesses the whole history from scratch.
      clearSyncBaselines();
      updateSyncState({ pullCursor: 0 });
      const result = await pull();

      expect(result.status).toBe('success');
      expect(transactionService.listTransactions()).toHaveLength(1);
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(categoryService.listCategories()).toHaveLength(categoryCount);
      expect(getAccountBalance(accountService.listAccounts()[0]!.id)).toBe(balanceAfterFirst);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('keeps the cursor and the data together across a restart', async () => {
      cloud.putRow('account', cloudAccount({ name: 'Persisted' }));
      await pull();
      const cursor = getSyncState()?.pullCursor;

      reopenTestDatabase();

      expect(getSyncState()?.pullCursor).toBe(cursor);
      expect(accountService.listAccounts()).toHaveLength(1);
      expect(readSyncBaseline('account', accountService.listAccounts()[0]!.syncId!)).toMatchObject({
        serverRevision: 1,
      });
    });

    it('rolls back the whole batch, cursor included, when applying fails', async () => {
      cloud.putRow('account', cloudAccount({ name: 'First' }));
      cloud.putRow('account', cloudAccount({ name: 'Second' }));
      applyControl.failAccountApply = true;

      const failed = await pull();

      expect(failed.status).toBe('error');
      expect(failed.failures[0]?.code).toBe('apply_failed');
      expect(accountService.listAccounts()).toHaveLength(0);
      expect(getSyncState()?.pullCursor).toBeNull();
      expect(getSyncState()?.lastSuccessfulPullAt).toBeNull();

      // Nothing was lost: the same changes apply cleanly on the next run.
      applyControl.failAccountApply = false;
      const recovered = await pull();

      expect(recovered.status).toBe('success');
      expect(accountService.listAccounts()).toHaveLength(2);
    });
  });

  describe('concurrency', () => {
    it('runs one pull at a time', async () => {
      cloud.putRow('account', cloudAccount());

      const [first, second] = await Promise.all([pull(), pull()]);

      const statuses = [first.status, second.status];
      expect(statuses).toContain('pulling');
      expect(accountService.listAccounts()).toHaveLength(1);
    });
  });
});

/** The settings singleton must stay a singleton however often it is pulled. */
function countSettingsRows(): number {
  const row = rawClient().prepare('SELECT count(*) AS total FROM settings').get();
  return Number((row as { total: unknown }).total);
}

function expenseInMonth(timestamp: number): number {
  const range = reportsService.getReportRange('this_month', new Date(timestamp));
  return reportsService.getReportSummary(range).expenseMinor;
}

function incomeInMonth(timestamp: number): number {
  const range = reportsService.getReportRange('this_month', new Date(timestamp));
  return reportsService.getReportSummary(range).incomeMinor;
}
