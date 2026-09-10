import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import * as personService from '@/features/people/person.service';
import * as reportsService from '@/features/reports/reports.service';
import * as settingsService from '@/features/settings/settings.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { linkUsingCloudData, linkUsingLocalData } from '@/features/sync/reconciliation.service';
import { listSyncConflicts } from '@/features/sync/sync-baseline.repository';
import { countPendingSyncMutations, getSyncState } from '@/features/sync/sync.repository';
import { syncNow } from '@/features/sync/sync.service';
import * as transactionService from '@/features/transactions/transaction.service';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';

import { TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

/**
 * Three real databases and one cloud.
 *
 * Two devices prove that sync works; three prove that it converges — that no
 * pair of devices can settle into a state the third disagrees with, and that a
 * conflict resolves to one winner rather than oscillating as each device pushes
 * its own answer back.
 */

const A = 'default';
const B = 'B';
const C = 'C';
const financialDate = new Date(2026, 0, 15);
const reportingNow = new Date(2026, 0, 20);
const rupees = (amount: number) => amount * 100;

let cloud: FakeCloud;

function reconcile() {
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
    },
  };
}

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

function on(device: string) {
  onDevice(device);
}

async function syncOn(device: string) {
  on(device);
  return sync();
}

function named<T extends { name: string }>(rows: T[], name: string): T {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`No row named ${name}.`);
  return row;
}

/** Everything a person would compare between devices. */
function financialSnapshot() {
  const range = reportsService.getReportRange('this_month', reportingNow);
  const dashboard = getDashboardSummary({ now: reportingNow });

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
        transactionDate: transaction.transactionDate.getTime(),
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
    categories: categoryService
      .listCategories()
      .map((category) => ({ syncId: category.syncId, name: category.name, type: category.type }))
      .sort(bySyncId),
    totalBalanceMinor: getTotalBalance(),
    dashboard: {
      totalBalanceMinor: dashboard.totalBalanceMinor,
      monthlyIncomeMinor: dashboard.monthlyIncomeMinor,
      monthlyExpenseMinor: dashboard.monthlyExpenseMinor,
      monthlySavingsMinor: dashboard.monthlySavingsMinor,
      categorySpending: dashboard.categorySpending.map((item) => ({
        categoryName: item.categoryName,
        amountMinor: item.amountMinor,
      })),
    },
    reports: {
      thisWeek: reportsService.getReportSummary(
        reportsService.getReportRange('this_week', reportingNow),
      ),
      thisMonth: reportsService.getReportSummary(range),
      lastMonth: reportsService.getReportSummary(
        reportsService.getReportRange('last_month', reportingNow),
      ),
      threeMonths: reportsService.getReportSummary(
        reportsService.getReportRange('last_3_months', reportingNow),
      ),
      sixMonths: reportsService.getReportSummary(
        reportsService.getReportRange('last_6_months', reportingNow),
      ),
      thisYear: reportsService.getReportSummary(
        reportsService.getReportRange('this_year', reportingNow),
      ),
      custom: reportsService.getReportSummary(
        reportsService.getCustomRange(new Date(2026, 0, 1), new Date(2026, 0, 31)),
      ),
    },
    defaultCurrency: settingsService.getAppSettings().defaultCurrency,
  };
}

function bySyncId(left: { syncId: string | null }, right: { syncId: string | null }) {
  return String(left.syncId).localeCompare(String(right.syncId));
}

function snapshotOf(device: string) {
  on(device);
  return financialSnapshot();
}

/** Device A's history, then B and C restored from the cloud. */
async function setUpThreeDevices() {
  on(A);
  const cash = accountService.createAccount({
    name: 'Cash',
    type: 'cash',
    openingBalanceMinor: rupees(20_000),
    currency: 'NPR',
  });
  const bank = accountService.createAccount({
    name: 'Bank',
    type: 'bank',
    openingBalanceMinor: rupees(50_000),
    currency: 'NPR',
  });
  const ram = personService.createPerson({ name: 'Ram' });
  const coffee = categoryService.createCategory({ name: 'Coffee', type: 'expense' });
  transactionService.createExpense({
    accountId: cash.id,
    categoryId: coffee.id,
    amountMinor: rupees(5_000),
    title: 'Coffee',
    paymentMode: 'cash',
    transactionDate: financialDate,
  });
  transactionService.createLend({
    personId: ram.id,
    accountId: cash.id,
    amountMinor: rupees(8_000),
    transactionDate: financialDate,
  });
  await linkUsingLocalData(reconcile());

  on(B);
  await linkUsingCloudData(reconcile());
  on(C);
  await linkUsingCloudData(reconcile());
  on(A);
  return { cash, bank, ram, coffee };
}

/**
 * Every test here builds and syncs three separate databases, which makes them
 * the second heaviest in the suite: 12 to 15 seconds each once the directory
 * runs in parallel. Their 60s budget was barely four times that, so they carry
 * an explicit 120s rather than leaning on it.
 */
describe('three devices', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await setupDevice(B);
    await setupDevice(C);
    on(A);
  });
  afterAll(() => closeTestDatabase());

  it('restores every device to the same figures', async () => {
    await setUpThreeDevices();

    const onA = snapshotOf(A);
    expect(snapshotOf(B)).toEqual(onA);
    expect(snapshotOf(C)).toEqual(onA);
    expect(onA.accounts.map((account) => account.balanceMinor).sort()).toEqual(
      [rupees(7_000), rupees(50_000)].sort(),
    );
  }, 120_000);

  it('carries independent records created on each device to all three', async () => {
    const { coffee } = await setUpThreeDevices();

    for (const [device, title, amount] of [
      [A, 'From A', 1_000],
      [B, 'From B', 2_000],
      [C, 'From C', 3_000],
    ] as const) {
      on(device);
      transactionService.createExpense({
        accountId: named(accountService.listAccounts(), 'Cash').id,
        categoryId: named(categoryService.listCategories(), coffee.name).id,
        amountMinor: rupees(amount),
        title,
        paymentMode: 'cash',
        transactionDate: financialDate,
      });
    }

    // Two rounds: everyone uploads, then everyone downloads.
    for (const device of [A, B, C]) await syncOn(device);
    for (const device of [A, B, C]) await syncOn(device);

    const onA = snapshotOf(A);
    expect(onA.transactions).toHaveLength(5);
    expect(snapshotOf(B)).toEqual(onA);
    expect(snapshotOf(C)).toEqual(onA);
    expect(onA.accounts.find((account) => account.name === 'Cash')?.balanceMinor).toBe(
      rupees(1_000),
    );
  }, 120_000);

  it('converges on one winner when all three edit the same record', async () => {
    await setUpThreeDevices();

    // Each device edits the same expense while offline from the others.
    for (const [device, amount] of [
      [A, 6_000],
      [B, 7_000],
      [C, 9_000],
    ] as const) {
      on(device);
      const expense = transactionService
        .listTransactions()
        .find((transaction) => transaction.type === 'expense')!;
      transactionService.updateExpense(expense.id, { amountMinor: rupees(amount) });
    }

    // A deterministic order: each device takes its turn, twice around.
    for (let round = 0; round < 2; round += 1) {
      for (const device of [A, B, C]) await syncOn(device);
    }

    const onA = snapshotOf(A);
    expect(snapshotOf(B)).toEqual(onA);
    expect(snapshotOf(C)).toEqual(onA);
    // One winner, and one expense — never three rows or an alternating amount.
    const expenses = onA.transactions.filter((row) => row.type === 'expense');
    expect(expenses).toHaveLength(1);
    expect([rupees(6_000), rupees(7_000), rupees(9_000)]).toContain(expenses[0]!.amountMinor);
  }, 120_000);

  it('settles: another round of syncing changes nothing', async () => {
    await setUpThreeDevices();
    on(B);
    const expense = transactionService
      .listTransactions()
      .find((transaction) => transaction.type === 'expense')!;
    transactionService.updateExpense(expense.id, { amountMinor: rupees(6_500) });
    for (let round = 0; round < 2; round += 1) {
      for (const device of [A, B, C]) await syncOn(device);
    }

    const settled = snapshotOf(A);
    for (const device of [A, B, C]) {
      const result = await syncOn(device);
      expect(result.status).toBe('success');
      expect(result.pushed).toBe(0);
      expect(result.pulled).toBe(0);
      expect(result.pending).toBe(0);
    }

    expect(snapshotOf(A)).toEqual(settled);
    expect(snapshotOf(B)).toEqual(settled);
    expect(snapshotOf(C)).toEqual(settled);
  }, 120_000);

  it('keeps a deletion deleted on every device, including a late one', async () => {
    await setUpThreeDevices();

    on(A);
    const expense = transactionService
      .listTransactions()
      .find((transaction) => transaction.type === 'expense')!;
    transactionService.deleteTransaction(expense.id);
    await syncOn(A);

    // B edits it while offline, then syncs. C is offline throughout and syncs last.
    on(B);
    const onB = transactionService
      .listTransactions()
      .find((transaction) => transaction.syncId === expense.syncId)!;
    transactionService.updateExpense(onB.id, { amountMinor: rupees(99_000) });
    await syncOn(B);
    await syncOn(C);
    for (const device of [A, B, C]) await syncOn(device);

    for (const device of [A, B, C]) {
      on(device);
      expect(
        transactionService.listTransactions().some((row) => row.syncId === expense.syncId),
        device,
      ).toBe(false);
    }
    const onA = snapshotOf(A);
    expect(snapshotOf(B)).toEqual(onA);
    expect(snapshotOf(C)).toEqual(onA);
  }, 120_000);

  it('keeps debt and transfer invariants identical on all three', async () => {
    const { ram } = await setUpThreeDevices();

    on(B);
    transactionService.createRepaymentReceived({
      personId: named(personService.listPeople(), 'Ram').id,
      accountId: named(accountService.listAccounts(), 'Cash').id,
      amountMinor: rupees(3_000),
      transactionDate: financialDate,
    });
    on(C);
    transactionService.createTransfer({
      sourceAccountId: named(accountService.listAccounts(), 'Bank').id,
      destinationAccountId: named(accountService.listAccounts(), 'Cash').id,
      amountMinor: rupees(10_000),
      transactionDate: financialDate,
    });

    for (const device of [A, B, C]) await syncOn(device);
    for (const device of [A, B, C]) await syncOn(device);

    const onA = snapshotOf(A);
    expect(snapshotOf(B)).toEqual(onA);
    expect(snapshotOf(C)).toEqual(onA);
    // Receivable fell by the repayment; the transfer moved money without
    // touching income or expense.
    expect(onA.people.find((person) => person.syncId === ram.syncId)).toMatchObject({
      receivableMinor: rupees(5_000),
      liabilityMinor: 0,
    });
    // 20,000 + 50,000 opening, less the 5,000 expense and the 8,000 lent, plus
    // the 3,000 repaid. The transfer moves money without changing the total.
    expect(onA.totalBalanceMinor).toBe(rupees(60_000));
    expect(onA.dashboard.monthlyIncomeMinor).toBe(0);
    expect(onA.dashboard.monthlyExpenseMinor).toBe(rupees(5_000));
  }, 120_000);

  it('leaves every device with a clean integrity report', async () => {
    await setUpThreeDevices();
    on(B);
    transactionService.createExpense({
      accountId: named(accountService.listAccounts(), 'Cash').id,
      categoryId: named(categoryService.listCategories(), 'Coffee').id,
      amountMinor: rupees(500),
      title: 'Extra',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    for (const device of [A, B, C]) await syncOn(device);
    for (const device of [A, B, C]) await syncOn(device);

    for (const device of [A, B, C]) {
      on(device);
      const report = verifySyncIntegrity();
      expect(report.issues, device).toEqual([]);
      expect(countPendingSyncMutations(), device).toBe(0);
      expect(listSyncConflicts().filter((row) => row.resolution === 'attention_required')).toEqual(
        [],
      );
      expect(getSyncState()?.lastSuccessfulSyncAt, device).toBeInstanceOf(Date);
    }
  }, 120_000);

  it('produces no duplicate cloud rows for one logical record', async () => {
    await setUpThreeDevices();
    on(B);
    transactionService.createExpense({
      accountId: named(accountService.listAccounts(), 'Cash').id,
      categoryId: named(categoryService.listCategories(), 'Coffee').id,
      amountMinor: rupees(500),
      title: 'Extra',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });
    for (let round = 0; round < 3; round += 1) {
      for (const device of [A, B, C]) await syncOn(device);
    }

    for (const entityType of [
      'account',
      'category',
      'person',
      'transaction',
      'settings',
    ] as const) {
      const identities = cloud
        .rows(entityType)
        .map((row) => (row as unknown as { sync_id: string }).sync_id);
      expect(new Set(identities).size, entityType).toBe(identities.length);
    }
    // One settings record per user, and one built-in per system key.
    expect(cloud.rows('settings')).toHaveLength(1);
    const systemKeys = cloud
      .rows('category')
      .map((row) => (row as unknown as { system_key: string | null }).system_key)
      .filter((key): key is string => key !== null);
    expect(new Set(systemKeys).size).toBe(systemKeys.length);
  }, 120_000);
});
