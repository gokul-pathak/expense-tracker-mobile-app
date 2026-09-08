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
import {
  inspectCloudLink,
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations, getCloudBinding } from '@/features/sync/sync.repository';
import { readCloudSyncState, syncNow } from '@/features/sync/sync.service';
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
 * The whole product flow, end to end, across two real SQLite databases.
 *
 * Device A is an existing user with months of records; device B is a fresh
 * install. Nothing is asserted through sync internals — every figure is read
 * back through the same services the screens use, because the promise being
 * tested is that a second device shows the same money as the first.
 */

const A = 'default';
const B = 'B';
const financialDate = new Date(2026, 0, 15);
const reportingNow = new Date(2026, 0, 20);

// Rupees in the milestone script; minor units in the domain.
const rupees = (amount: number) => amount * 100;

let cloud: FakeCloud;

function reconcile(): ReconciliationOptions {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason) => ({
        reason,
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

function categoryNamed(name: string) {
  const category = categoryService.listCategories().find((item) => item.name === name);
  if (category === undefined) throw new Error(`No category named ${name}.`);
  return category;
}

function accountNamed(name: string) {
  const account = accountService.listAccounts().find((item) => item.name === name);
  if (account === undefined) throw new Error(`No account named ${name}.`);
  return account;
}

function personNamed(name: string) {
  const person = personService.listPeople().find((item) => item.name === name);
  if (person === undefined) throw new Error(`No person named ${name}.`);
  return person;
}

/** The milestone's worked example, entered exactly as a user would enter it. */
function buildDeviceAHistory() {
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
  const sita = personService.createPerson({ name: 'Sita' });

  transactionService.createIncome({
    accountId: bank.id,
    categoryId: categoryNamed('Salary').id,
    amountMinor: rupees(65_000),
    title: 'Salary',
    paymentMode: 'bank_transfer',
    transactionDate: financialDate,
  });
  transactionService.createExpense({
    accountId: cash.id,
    categoryId: categoryNamed('Food').id,
    amountMinor: rupees(5_000),
    title: 'Food',
    paymentMode: 'cash',
    transactionDate: financialDate,
  });
  transactionService.createTransfer({
    sourceAccountId: bank.id,
    destinationAccountId: cash.id,
    amountMinor: rupees(10_000),
    transactionDate: financialDate,
  });
  transactionService.createLend({
    personId: ram.id,
    accountId: cash.id,
    amountMinor: rupees(8_000),
    transactionDate: financialDate,
  });
  transactionService.createRepaymentReceived({
    personId: ram.id,
    accountId: cash.id,
    amountMinor: rupees(3_000),
    transactionDate: financialDate,
  });
  transactionService.createBorrow({
    personId: sita.id,
    accountId: bank.id,
    amountMinor: rupees(12_000),
    transactionDate: financialDate,
  });
  transactionService.createRepaymentPaid({
    personId: sita.id,
    accountId: bank.id,
    amountMinor: rupees(4_000),
    transactionDate: financialDate,
  });

  return { cash, bank, ram, sita };
}

type Snapshot = ReturnType<typeof financialSnapshot>;

/** Everything a person would compare between two devices. */
function financialSnapshot() {
  const range = reportsService.getReportRange('this_month', reportingNow);
  const dashboard = getDashboardSummary({ now: reportingNow });
  const report = reportsService.getReportSummary(range);

  return {
    accounts: accountService
      .listAccounts()
      .map((account) => ({
        syncId: account.syncId,
        name: account.name,
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
        };
      })
      .sort(bySyncId),
    categories: categoryService
      .listCategories()
      .map((category) => ({ syncId: category.syncId, name: category.name }))
      .sort(bySyncId),
    totalBalanceMinor: getTotalBalance(),
    dashboard: {
      totalBalanceMinor: dashboard.totalBalanceMinor,
      monthlyIncomeMinor: dashboard.monthlyIncomeMinor,
      monthlyExpenseMinor: dashboard.monthlyExpenseMinor,
      monthlySavingsMinor: dashboard.monthlySavingsMinor,
    },
    report,
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

describe('new device restore', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await setupDevice(B);
    on(A);
  });
  afterAll(() => closeTestDatabase());

  it('carries a whole existing device to a fresh install, figure for figure', async () => {
    on(A);
    const { cash, bank, ram, sita } = buildDeviceAHistory();

    // Device A links for the first time: its data goes up.
    const inspectionA = await inspectCloudLink(reconcile());
    expect(inspectionA.status === 'ok' && inspectionA.inspection.case).toBe('B');
    const linkedA = await linkUsingLocalData(reconcile());
    expect(linkedA).toMatchObject({ status: 'linked', case: 'B' });

    // The milestone's expected figures, on the device that entered them.
    expect(getAccountBalance(cash.id)).toBe(rupees(20_000));
    expect(getAccountBalance(bank.id)).toBe(rupees(113_000));
    expect(getTotalBalance()).toBe(rupees(133_000));
    expect(transactionService.getPersonFinancialSummary(ram.id).receivableMinor).toBe(
      rupees(5_000),
    );
    expect(transactionService.getPersonFinancialSummary(sita.id).liabilityMinor).toBe(
      rupees(8_000),
    );

    // Device B is a fresh install that signs in and finds data waiting.
    on(B);
    const inspectionB = await inspectCloudLink(reconcile());
    expect(inspectionB.status === 'ok' && inspectionB.inspection.case).toBe('C');
    const linkedB = await linkUsingCloudData(reconcile());
    expect(linkedB).toMatchObject({ status: 'linked', case: 'C', choice: 'use_cloud' });

    on(B);
    const cashOnB = accountNamed('Cash');
    const bankOnB = accountNamed('Bank');
    expect(getAccountBalance(cashOnB.id)).toBe(rupees(20_000));
    expect(getAccountBalance(bankOnB.id)).toBe(rupees(113_000));
    expect(getTotalBalance()).toBe(rupees(133_000));

    const dashboard = getDashboardSummary({ now: reportingNow });
    expect(dashboard.monthlyIncomeMinor).toBe(rupees(65_000));
    expect(dashboard.monthlyExpenseMinor).toBe(rupees(5_000));
    expect(dashboard.monthlySavingsMinor).toBe(rupees(60_000));
    expect(transactionService.getPersonFinancialSummary(personNamed('Ram').id)).toMatchObject({
      receivableMinor: rupees(5_000),
    });
    expect(transactionService.getPersonFinancialSummary(personNamed('Sita').id)).toMatchObject({
      liabilityMinor: rupees(8_000),
    });

    // Identical source records, and therefore identical derived figures.
    expect(snapshotOf(B)).toEqual(snapshotOf(A));
    // Nothing derived was transported to make that true.
    const uploaded = JSON.stringify(cloud.calls);
    for (const forbidden of ['current_balance', 'receivable', 'savings', 'monthly', 'dashboard']) {
      expect(uploaded).not.toContain(forbidden);
    }
  });

  it('keeps global identities while giving the new device its own local keys', async () => {
    on(A);
    const { cash } = buildDeviceAHistory();
    await linkUsingLocalData(reconcile());

    on(B);
    await linkUsingCloudData(reconcile());

    on(B);
    const cashOnB = accountNamed('Cash');
    expect(cashOnB.syncId).toBe(cash.syncId);
    expect(cashOnB.id).toBeGreaterThan(0);
    // Relationships still resolve through the new device's own integer keys.
    const expense = transactionService
      .listTransactions()
      .find((transaction) => transaction.type === 'expense')!;
    expect(expense.sourceAccountId).toBe(cashOnB.id);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('does not duplicate built-in categories on the restored device', async () => {
    on(A);
    buildDeviceAHistory();
    await linkUsingLocalData(reconcile());
    const categoriesOnA = categoryService.listCategories().length;

    on(B);
    await linkUsingCloudData(reconcile());

    on(B);
    const food = categoryService
      .listCategories()
      .filter((category) => category.systemKey === 'expense_food');
    expect(food).toHaveLength(1);
    expect(categoryService.listCategories()).toHaveLength(categoriesOnA);
  });

  describe('ongoing two-device sync', () => {
    beforeEach(async () => {
      on(A);
      buildDeviceAHistory();
      await linkUsingLocalData(reconcile());
      on(B);
      await linkUsingCloudData(reconcile());
      on(A);
    });

    it('carries a new expense entered on the restored device back to the first', async () => {
      on(B);
      const bankOnB = accountNamed('Bank');
      transactionService.createExpense({
        accountId: bankOnB.id,
        categoryId: categoryNamed('Shopping').id,
        amountMinor: rupees(7_000),
        title: 'Shopping',
        paymentMode: 'debit_card',
        transactionDate: financialDate,
      });
      await sync();

      on(A);
      await sync();

      on(A);
      expect(getAccountBalance(accountNamed('Bank').id)).toBe(rupees(106_000));
      expect(getTotalBalance()).toBe(rupees(126_000));
      const dashboard = getDashboardSummary({ now: reportingNow });
      expect(dashboard.monthlyExpenseMinor).toBe(rupees(12_000));
      expect(dashboard.monthlySavingsMinor).toBe(rupees(53_000));
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
    });

    it('keeps the total balance invariant across a synced transfer', async () => {
      on(B);
      const totalBefore = getTotalBalance();
      const incomeBefore = getDashboardSummary({ now: reportingNow }).monthlyIncomeMinor;
      transactionService.createTransfer({
        sourceAccountId: accountNamed('Cash').id,
        destinationAccountId: accountNamed('Bank').id,
        amountMinor: rupees(2_000),
        transactionDate: financialDate,
      });
      await sync();

      on(A);
      await sync();

      on(A);
      expect(getTotalBalance()).toBe(totalBefore);
      expect(getDashboardSummary({ now: reportingNow }).monthlyIncomeMinor).toBe(incomeBefore);
      expect(getDashboardSummary({ now: reportingNow }).monthlyExpenseMinor).toBe(rupees(5_000));
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
    });

    it('keeps a debt repayment out of income and expense on both devices', async () => {
      on(B);
      transactionService.createRepaymentReceived({
        personId: personNamed('Ram').id,
        accountId: accountNamed('Cash').id,
        amountMinor: rupees(2_000),
        transactionDate: financialDate,
      });
      await sync();

      on(A);
      await sync();

      on(A);
      expect(transactionService.getPersonFinancialSummary(personNamed('Ram').id)).toMatchObject({
        receivableMinor: rupees(3_000),
      });
      expect(getAccountBalance(accountNamed('Cash').id)).toBe(rupees(22_000));
      expect(getDashboardSummary({ now: reportingNow }).monthlyIncomeMinor).toBe(rupees(65_000));
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
    });

    it('carries an edit made on the first device to the restored one', async () => {
      on(A);
      const expense = transactionService
        .listTransactions()
        .find((transaction) => transaction.type === 'expense')!;
      transactionService.updateExpense(expense.id, { amountMinor: rupees(6_000) });
      await sync();

      on(B);
      await sync();

      on(B);
      expect(getAccountBalance(accountNamed('Cash').id)).toBe(rupees(19_000));
      expect(transactionService.listTransactions()).toHaveLength(7);
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
    });

    it('does not resurrect a record deleted on the other device', async () => {
      on(A);
      const expense = transactionService
        .listTransactions()
        .find((transaction) => transaction.type === 'expense')!;
      transactionService.deleteTransaction(expense.id);
      await sync();

      on(B);
      await sync();

      on(B);
      expect(transactionService.listTransactions()).toHaveLength(6);
      expect(getAccountBalance(accountNamed('Cash').id)).toBe(rupees(25_000));

      // A further round trip must not bring it back.
      await sync();
      on(A);
      await sync();
      expect(snapshotOf(A).transactions).toHaveLength(6);
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
    });

    it('converges after both devices edit the same record offline', async () => {
      on(A);
      const expenseOnA = transactionService
        .listTransactions()
        .find((transaction) => transaction.type === 'expense')!;
      on(B);
      const expenseOnB = transactionService
        .listTransactions()
        .find((transaction) => transaction.syncId === expenseOnA.syncId)!;

      on(A);
      transactionService.updateExpense(expenseOnA.id, { amountMinor: rupees(7_000) });
      await sync();

      on(B);
      transactionService.updateExpense(expenseOnB.id, { amountMinor: rupees(9_000) });
      await sync();

      on(A);
      await sync();
      on(B);
      await sync();

      // Whichever side wins, both devices must end up saying the same thing.
      expect(snapshotOf(B)).toEqual(snapshotOf(A));
      expect(snapshotOf(A).transactions.filter((row) => row.type === 'expense')).toHaveLength(1);
    });

    it('reports a synced device only once both directions are settled', async () => {
      on(B);
      transactionService.createExpense({
        accountId: accountNamed('Bank').id,
        categoryId: categoryNamed('Shopping').id,
        amountMinor: rupees(1_000),
        title: 'Snack',
        paymentMode: 'cash',
        transactionDate: financialDate,
      });

      const pending = readCloudSyncState({ configured: true, authenticatedUserId: TEST_USER });
      expect(pending.status).toBe('pending_changes');
      expect(pending.pendingChanges).toBe(1);

      await sync();

      const settled = readCloudSyncState({ configured: true, authenticatedUserId: TEST_USER });
      expect(settled.status).toBe('synced');
      expect(settled.pendingChanges).toBe(0);
      expect(getCloudBinding().linkedUserId).toBe(TEST_USER);
    });
  });
});
