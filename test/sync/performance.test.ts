import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import * as personService from '@/features/people/person.service';
import * as reportsService from '@/features/reports/reports.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { linkUsingCloudData, linkUsingLocalData } from '@/features/sync/reconciliation.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { syncNow } from '@/features/sync/sync.service';
import { createSyncId } from '@/features/sync/uuid';
import * as transactionService from '@/features/transactions/transaction.service';
import { getTotalBalance } from '@/features/transactions/account-balance.service';

import { TEST_USER } from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * A dataset large enough to be worth measuring.
 *
 * The assertions are about behaviour that must hold at any size — every record
 * arrives, nothing duplicates, requests stay batched, and derived figures still
 * match. The timings are printed rather than asserted: they depend on the
 * machine, and a threshold that passes here would say nothing about a phone.
 */

const ACCOUNTS = 5;
const CATEGORIES = 25;
const PEOPLE = 50;
const TRANSACTIONS = 5000;

const A = 'default';
const B = 'B';
const financialDate = new Date(2026, 0, 15);
const reportingNow = new Date(2026, 0, 20);

let cloud: FakeCloud;
const timings: Record<string, number> = {};

function measure<T>(label: string, run: () => T): T {
  const started = Date.now();
  const result = run();
  timings[label] = Date.now() - started;
  return result;
}

async function measureAsync<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await run();
  timings[label] = Date.now() - started;
  return result;
}

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

/**
 * The fixture is written straight to SQLite. Creating five thousand records
 * through the domain services would measure the services, not synchronization,
 * and every row still gets a real global identity and valid relationships.
 */
function buildLargeDataset() {
  const client = rawClient();
  const now = Date.now();
  const date = financialDate.getTime();

  const accountIds: number[] = [];
  for (let index = 0; index < ACCOUNTS; index += 1) {
    const info = client
      .prepare(
        'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      )
      .get(`Account ${index}`, 'cash', 1_000_000, 'NPR', 0, now, now, createSyncId());
    accountIds.push(Number((info as { id: number }).id));
  }

  const categoryIds: number[] = [];
  for (let index = 0; index < CATEGORIES; index += 1) {
    const info = client
      .prepare(
        'INSERT INTO categories (name, type, icon, system_key, is_default, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      )
      .get(`Custom ${index}`, 'expense', null, null, 0, now, now, createSyncId());
    categoryIds.push(Number((info as { id: number }).id));
  }

  const peopleIds: number[] = [];
  for (let index = 0; index < PEOPLE; index += 1) {
    const info = client
      .prepare(
        'INSERT INTO people (name, note, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?) RETURNING id',
      )
      .get(`Person ${index}`, null, 0, now, now, createSyncId());
    peopleIds.push(Number((info as { id: number }).id));
  }

  const insertTransaction = client.prepare(
    'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, destination_account_id, person_id, payment_mode, transaction_date, title, note, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  client.exec('BEGIN');
  for (let index = 0; index < TRANSACTIONS; index += 1) {
    insertTransaction.run(
      'expense',
      100 + (index % 900),
      'NPR',
      categoryIds[index % CATEGORIES]!,
      accountIds[index % ACCOUNTS]!,
      null,
      null,
      'cash',
      date,
      `Expense ${index}`,
      null,
      now,
      now,
      createSyncId(),
    );
  }
  client.exec('COMMIT');

  return { accountIds, categoryIds, peopleIds };
}

describe('large dataset synchronization', () => {
  beforeAll(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await setupDevice(B);
    onDevice(A);
    measure('fixture.build', buildLargeDataset);
  }, 300_000);

  afterAll(() => {
    closeTestDatabase();
    // Real measurements from this machine, reported rather than asserted.
    // eslint-disable-next-line no-console
    console.log('sync performance (ms):', JSON.stringify(timings));
  });

  it('uploads a whole large device in bounded batches', async () => {
    onDevice(A);
    const result = await measureAsync('initialUpload', () => linkUsingLocalData(reconcile()));

    expect(result.status).toBe('linked');
    expect(cloud.rows('transaction')).toHaveLength(TRANSACTIONS);
    expect(cloud.rows('account')).toHaveLength(ACCOUNTS);
    expect(cloud.rows('person')).toHaveLength(PEOPLE);
    // Never one enormous request, and never one request per row.
    const largest = Math.max(...cloud.calls.map((call) => call.rows.length));
    expect(largest).toBeLessThanOrEqual(100);
    expect(cloud.calls.length).toBeLessThan(TRANSACTIONS / 10);
    expect(countPendingSyncMutations()).toBe(0);
  }, 300_000);

  it('restores a whole large device onto a fresh one, exactly once each', async () => {
    onDevice(B);
    const result = await measureAsync('initialDownload', () => linkUsingCloudData(reconcile()));

    expect(result.status).toBe('linked');
    onDevice(B);
    expect(transactionService.listTransactions()).toHaveLength(TRANSACTIONS);
    expect(accountService.listAccounts()).toHaveLength(ACCOUNTS);
    expect(personService.listPeople()).toHaveLength(PEOPLE);
    // The seeded built-ins plus the custom categories, with nothing duplicated.
    expect(categoryService.listCategories().length).toBeGreaterThanOrEqual(CATEGORIES);
    const identities = transactionService.listTransactions().map((row) => row.syncId);
    expect(new Set(identities).size).toBe(TRANSACTIONS);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().ok).toBe(true);
  }, 300_000);

  it('derives the same figures on the restored device', () => {
    onDevice(A);
    const onA = measure('dashboard.deviceA', () => getDashboardSummary({ now: reportingNow }));
    const totalA = getTotalBalance();
    const reportA = measure('report.deviceA', () =>
      reportsService.getReportSummary(reportsService.getReportRange('this_month', reportingNow)),
    );

    onDevice(B);
    const onB = measure('dashboard.deviceB', () => getDashboardSummary({ now: reportingNow }));
    const totalB = getTotalBalance();
    const reportB = measure('report.deviceB', () =>
      reportsService.getReportSummary(reportsService.getReportRange('this_month', reportingNow)),
    );

    expect(totalB).toBe(totalA);
    expect(onB.monthlyExpenseMinor).toBe(onA.monthlyExpenseMinor);
    expect(onB.monthlyIncomeMinor).toBe(onA.monthlyIncomeMinor);
    expect(onB.totalBalanceMinor).toBe(onA.totalBalanceMinor);
    expect(reportB).toEqual(reportA);
  });

  it('stays incremental afterwards: one change is one change', async () => {
    onDevice(A);
    const account = accountService.listAccounts()[0]!;
    const category = categoryService.listCategories().find((row) => row.name === 'Custom 0')!;
    transactionService.createExpense({
      accountId: account.id,
      categoryId: category.id,
      amountMinor: 4242,
      title: 'One more',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    const callsBefore = cloud.calls.length;
    const pushResult = await measureAsync('incrementalSync.deviceA', () => sync());

    expect(pushResult.status).toBe('success');
    // One record uploaded, not the whole database rescanned.
    const uploadedRows = cloud.calls
      .slice(callsBefore)
      .reduce((total, call) => total + call.rows.length, 0);
    expect(uploadedRows).toBe(1);

    onDevice(B);
    const pullResult = await measureAsync('incrementalSync.deviceB', () => sync());

    expect(pullResult.pulled).toBe(1);
    onDevice(B);
    expect(transactionService.listTransactions()).toHaveLength(TRANSACTIONS + 1);
  }, 300_000);

  it('makes almost no remote work when nothing has changed', async () => {
    onDevice(B);
    await sync();
    const callsBefore = cloud.pullCalls.length;

    const result = await measureAsync('noChangeSync', () => sync());

    expect(result).toMatchObject({ pushed: 0, pulled: 0, deleted: 0, pending: 0 });
    // One change-feed read, and no row fetches at all.
    expect(cloud.pullCalls.length - callsBefore).toBe(1);
  }, 120_000);
});
