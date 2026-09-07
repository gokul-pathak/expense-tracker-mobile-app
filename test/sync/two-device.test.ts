import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import * as personService from '@/features/people/person.service';
import * as reportsService from '@/features/reports/reports.service';
import * as settingsService from '@/features/settings/settings.service';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import { listSyncConflicts } from '@/features/sync/sync-baseline.repository';
import { countPendingSyncMutations, updateSyncState } from '@/features/sync/sync.repository';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

/**
 * Two real SQLite databases and one cloud.
 *
 * Every scenario here is written the way a user would produce it: device A makes
 * ordinary domain calls and pushes; device B pulls and is inspected through the
 * same repositories the screens use. Nothing derived is ever transported — the
 * two devices agree on balances, dashboards, reports and receivables only
 * because they agree on the source records.
 */

const A = 'default';
const B = 'B';
const financialDate = new Date(2026, 0, 15);
const reportingNow = new Date(2026, 0, 20);

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

async function syncFrom(device: string) {
  on(device);
  return push();
}

async function syncTo(device: string) {
  on(device);
  return pull();
}

type Snapshot = ReturnType<typeof financialSnapshot>;

/** Everything a user would compare between two devices. */
function financialSnapshot() {
  const range = reportsService.getReportRange('this_month', reportingNow);
  const dashboard = getDashboardSummary({ now: reportingNow });
  const summary = reportsService.getReportSummary(range);

  return {
    accounts: accountService
      .listAccounts()
      .map((account) => ({
        syncId: account.syncId,
        name: account.name,
        isArchived: account.isArchived,
        balanceMinor: getAccountBalance(account.id),
      }))
      .sort(bySyncId),
    transactions: transactionService
      .listTransactions()
      .map((transaction) => ({
        syncId: transaction.syncId,
        type: transaction.type,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        transactionDate: transaction.transactionDate.getTime(),
        title: transaction.title,
      }))
      .sort(bySyncId),
    people: personService
      .listPeople()
      .map((person) => {
        const totals = transactionService.getPersonFinancialSummary(person.id);
        return {
          syncId: person.syncId,
          name: person.name,
          receivableMinor: totals.receivableMinor,
          liabilityMinor: totals.liabilityMinor,
          status: totals.status,
        };
      })
      .sort(bySyncId),
    totalBalanceMinor: getTotalBalance(),
    dashboard: {
      totalBalanceMinor: dashboard.totalBalanceMinor,
      monthlyIncomeMinor: dashboard.monthlyIncomeMinor,
      monthlyExpenseMinor: dashboard.monthlyExpenseMinor,
      monthlySavingsMinor: dashboard.monthlySavingsMinor,
    },
    report: summary,
    defaultCurrency: settingsService.getAppSettings().defaultCurrency,
  };
}

function bySyncId(left: { syncId: string | null }, right: { syncId: string | null }) {
  return String(left.syncId).localeCompare(String(right.syncId));
}

function snapshotOf(device: string): Snapshot {
  on(device);
  return financialSnapshot();
}

/** A shared account and custom category, created on A and downloaded by B. */
async function sharedParents() {
  on(A);
  const cash = accountService.createAccount({
    name: 'Cash',
    type: 'cash',
    openingBalanceMinor: 1000000,
    currency: 'NPR',
  });
  const category = categoryService.createCategory({ name: 'Coffee', type: 'expense' });
  await push();
  await syncTo(B);
  on(A);
  return { cash, category };
}

function localBySyncId<T extends { syncId: string | null }>(rows: T[], syncId: string): T {
  const row = rows.find((candidate) => candidate.syncId === syncId);
  if (row === undefined) throw new Error(`No local row with sync id ${syncId}.`);
  return row;
}

describe('two devices', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    updateSyncState({ linkedUserId: TEST_USER });
    await setupDevice(B);
    updateSyncState({ linkedUserId: TEST_USER });
    on(A);
  });
  afterAll(() => closeTestDatabase());

  it('gives each device its own database and its own seeded identities', () => {
    on(A);
    const seededOnA = categoryService.listExpenseCategories()[0]!;
    on(B);
    const seededOnB = categoryService.listExpenseCategories()[0]!;

    expect(seededOnA.syncId).not.toBe(seededOnB.syncId);
    expect(seededOnA.systemKey).toBe(seededOnB.systemKey);
  });

  it('carries a created expense to the other device with converged figures', async () => {
    const { cash, category } = await sharedParents();
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();

    const result = await syncTo(B);

    expect(result.status).toBe('success');
    on(B);
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(countPendingSyncMutations()).toBe(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
    expect(snapshotOf(B).accounts[0]!.balanceMinor).toBe(995000);
  });

  it('carries an edit without duplicating the record', async () => {
    const { cash, category } = await sharedParents();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    on(A);
    transactionService.updateExpense(expense.id, { amountMinor: 7000, title: 'Dinner' });
    await push();
    await syncTo(B);

    on(B);
    const transactions = transactionService.listTransactions();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amountMinor: 7000, title: 'Dinner' });
    expect(countPendingSyncMutations()).toBe(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('carries a deletion, with its financial effect, and does not resurrect it', async () => {
    const { cash, category } = await sharedParents();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    on(A);
    transactionService.deleteTransaction(expense.id);
    await push();
    await syncTo(B);

    on(B);
    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(getAccountBalance(localBySyncId(accountService.listAccounts(), cash.syncId!).id)).toBe(
      1000000,
    );
    expect(countPendingSyncMutations()).toBe(0);

    // Another round trip must not bring it back.
    await syncFrom(B);
    await syncTo(A);
    expect(snapshotOf(A).transactions).toHaveLength(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('resolves concurrent edits deterministically and converges both devices', async () => {
    const { cash, category } = await sharedParents();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 50000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    // A edits and reaches the server first.
    on(A);
    transactionService.updateExpense(expense.id, { amountMinor: 70000 });
    await push();

    // B edited offline from the same baseline.
    on(B);
    const onB = localBySyncId(transactionService.listTransactions(), expense.syncId!);
    transactionService.updateExpense(onB.id, { amountMinor: 90000 });

    const pulled = await pull();

    // B's change has not reached the server yet, so it resolves later and wins.
    expect(pulled.conflicts[0]).toMatchObject({ resolution: 'local_wins' });
    expect(transactionService.listTransactions()[0]!.amountMinor).toBe(90000);

    await push();
    await syncTo(A);

    expect(snapshotOf(A).transactions[0]!.amountMinor).toBe(90000);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('lets a deletion on one device beat an offline edit on the other', async () => {
    const { cash, category } = await sharedParents();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 50000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    on(A);
    transactionService.deleteTransaction(expense.id);
    await push();

    on(B);
    const onB = localBySyncId(transactionService.listTransactions(), expense.syncId!);
    transactionService.updateExpense(onB.id, { amountMinor: 90000 });

    const pulled = await pull();

    expect(pulled.conflicts[0]).toMatchObject({ resolution: 'remote_delete_wins' });
    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(getAccountBalance(localBySyncId(accountService.listAccounts(), cash.syncId!).id)).toBe(
      1000000,
    );

    await push();
    await syncTo(A);
    expect(snapshotOf(A).transactions).toHaveLength(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('keeps both records when each device created one offline', async () => {
    const { cash, category } = await sharedParents();

    on(A);
    const fromA = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 1000,
      title: 'From A',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    on(B);
    const accountOnB = localBySyncId(accountService.listAccounts(), cash.syncId!);
    const categoryOnB = localBySyncId(categoryService.listCategories(), category.syncId!);
    const fromB = transactionService.createExpense({
      accountId: accountOnB.id,
      categoryId: categoryOnB.id,
      amountMinor: 2000,
      title: 'From B',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    expect(fromA.syncId).not.toBe(fromB.syncId);

    await syncFrom(A);
    await syncFrom(B);
    await syncTo(A);
    await syncTo(B);

    expect(snapshotOf(A).transactions).toHaveLength(2);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
    expect(snapshotOf(A).accounts[0]!.balanceMinor).toBe(997000);
  });

  it('carries a transfer as one transfer, leaving the total balance invariant', async () => {
    on(A);
    const bank = accountService.createAccount({
      name: 'Bank',
      type: 'bank',
      openingBalanceMinor: 500000,
      currency: 'NPR',
    });
    const wallet = accountService.createAccount({
      name: 'Wallet',
      type: 'wallet',
      openingBalanceMinor: 0,
      currency: 'NPR',
    });
    transactionService.createTransfer({
      sourceAccountId: bank.id,
      destinationAccountId: wallet.id,
      amountMinor: 5000,
      transactionDate: financialDate,
    });
    await push();

    await syncTo(B);

    on(B);
    const accounts = accountService.listAccounts();
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(transactionService.listTransactions()[0]!.type).toBe('transfer');
    expect(getAccountBalance(localBySyncId(accounts, bank.syncId!).id)).toBe(495000);
    expect(getAccountBalance(localBySyncId(accounts, wallet.syncId!).id)).toBe(5000);
    expect(getTotalBalance()).toBe(500000);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
    expect(snapshotOf(B).dashboard.monthlyIncomeMinor).toBe(0);
    expect(snapshotOf(B).dashboard.monthlyExpenseMinor).toBe(0);
  });

  it('carries a lend and its repayment with the same receivable on both devices', async () => {
    on(A);
    const cash = accountService.createAccount({
      name: 'Cash',
      type: 'cash',
      openingBalanceMinor: 1000000,
      currency: 'NPR',
    });
    const ram = personService.createPerson({ name: 'Ram' });
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 300000,
      transactionDate: financialDate,
    });
    transactionService.createRepaymentReceived({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 100000,
      transactionDate: financialDate,
    });
    await push();

    const result = await syncTo(B);

    expect(result.status).toBe('success');
    on(B);
    const personOnB = localBySyncId(personService.listPeople(), ram.syncId!);
    expect(transactionService.getPersonFinancialSummary(personOnB.id)).toMatchObject({
      receivableMinor: 200000,
      liabilityMinor: 0,
      status: 'partially_paid',
    });
    expect(getAccountBalance(localBySyncId(accountService.listAccounts(), cash.syncId!).id)).toBe(
      800000,
    );
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
    expect(snapshotOf(B).dashboard.monthlyExpenseMinor).toBe(0);
  });

  it('carries a mixed batch of parents and children in one pull', async () => {
    on(A);
    const cash = accountService.createAccount({
      name: 'Cash',
      type: 'cash',
      openingBalanceMinor: 1000000,
      currency: 'NPR',
    });
    const category = categoryService.createCategory({ name: 'Coffee', type: 'expense' });
    const ram = personService.createPerson({ name: 'Ram' });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Espresso',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 20000,
      transactionDate: financialDate,
    });
    settingsService.updateDefaultCurrency('npr');
    await push();

    const result = await syncTo(B);

    expect(result.status).toBe('success');
    on(B);
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(personService.listPeople()).toHaveLength(1);
    expect(transactionService.listTransactions()).toHaveLength(2);
    expect(countPendingSyncMutations()).toBe(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('carries an archive without destroying the history that depends on it', async () => {
    const { cash, category } = await sharedParents();
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    on(A);
    accountService.archiveAccount(cash.id);
    await push();
    await syncTo(B);

    on(B);
    expect(accountService.listArchivedAccounts()).toHaveLength(1);
    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });

  it('agrees on every derived figure after a full round trip', async () => {
    const { cash, category } = await sharedParents();
    on(A);
    const ram = personService.createPerson({ name: 'Ram' });
    const bank = accountService.createAccount({
      name: 'Bank',
      type: 'bank',
      openingBalanceMinor: 2000000,
      currency: 'NPR',
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 12500,
      title: 'Groceries',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    transactionService.createTransfer({
      sourceAccountId: bank.id,
      destinationAccountId: cash.id,
      amountMinor: 300000,
      transactionDate: financialDate,
    });
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: 150000,
      transactionDate: financialDate,
    });
    transactionService.createRepaymentReceived({
      personId: ram.id,
      accountId: bank.id,
      amountMinor: 50000,
      transactionDate: financialDate,
    });
    await push();

    await syncTo(B);

    const onA = snapshotOf(A);
    const onB = snapshotOf(B);
    expect(onB).toEqual(onA);
    // The figures agree because the source records agree, not because any total
    // was transported: no derived value exists in the cloud contract at all.
    expect(JSON.stringify(cloud.calls)).not.toMatch(/balance_minor"?:\s*\d+,"?current/);
    expect(JSON.stringify(cloud.calls)).not.toContain('receivable');
    expect(JSON.stringify(cloud.calls)).not.toContain('savings');
    expect(onB.people[0]).toMatchObject({ receivableMinor: 100000, liabilityMinor: 0 });
  });

  it('leaves no conflict behind when the devices simply take turns', async () => {
    const { cash, category } = await sharedParents();
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    await push();
    await syncTo(B);

    on(B);
    const accountOnB = localBySyncId(accountService.listAccounts(), cash.syncId!);
    accountService.updateAccount(accountOnB.id, { name: 'Pocket' });
    await push();
    await syncTo(A);

    on(A);
    expect(accountService.getAccount(cash.id).name).toBe('Pocket');
    expect(listSyncConflicts()).toHaveLength(0);
    on(B);
    expect(listSyncConflicts()).toHaveLength(0);
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
  });
});
