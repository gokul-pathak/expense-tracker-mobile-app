import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { isSyncId } from '@/db/schema';
import { listAccounts } from '@/features/accounts/account.service';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
  type LegacyBackupEnvelope,
} from '@/features/backup/backup.types';
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import { validateBackup } from '@/features/backup/backup.validation';
import { listCategories } from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { getReportSummary } from '@/features/reports/reports.service';
import {
  countPendingSyncMutations,
  getSyncState,
  updateSyncState,
} from '@/features/sync/sync.repository';
import { getTotalBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  expenseCategory,
  incomeCategory,
  makeAccount,
  makePerson,
  setupDatabase,
} from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

const transactionDate = new Date(2026, 0, 15);
const range = { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) };

function buildFinancialHistory() {
  const cash = makeAccount('Cash', 'NPR', 100000);
  const bank = makeAccount('Bank', 'NPR', 500000);
  const person = makePerson('Ram');
  transactionService.createIncome({
    accountId: bank.id,
    categoryId: incomeCategory().id,
    amountMinor: 80000,
    title: 'Salary',
    paymentMode: 'bank_transfer',
    transactionDate,
  });
  transactionService.createExpense({
    accountId: cash.id,
    categoryId: expenseCategory().id,
    amountMinor: 12000,
    title: 'Groceries',
    paymentMode: 'cash',
    transactionDate,
  });
  transactionService.createTransfer({
    sourceAccountId: bank.id,
    destinationAccountId: cash.id,
    amountMinor: 25000,
    transactionDate,
  });
  transactionService.createLend({
    personId: person.id,
    accountId: cash.id,
    amountMinor: 30000,
    transactionDate,
  });
  return { cash, bank, person };
}

function snapshot(personId: number) {
  return {
    totalBalance: getTotalBalance(),
    dashboard: getDashboardSummary({ now: transactionDate }),
    report: getReportSummary(range),
    person: transactionService.getPersonFinancialSummary(personId),
  };
}

/** Converts a current backup to the pre-M7C shape a released build produced. */
function toLegacyEnvelope(backup: BackupEnvelope): LegacyBackupEnvelope {
  const strip = <T extends { syncId: string }>(items: T[]) =>
    items.map(({ syncId: _syncId, ...rest }) => rest);
  return {
    format: BACKUP_FORMAT,
    formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
    schemaVersion: LEGACY_BACKUP_SCHEMA_VERSION,
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    data: {
      accounts: strip(backup.data.accounts),
      categories: strip(backup.data.categories),
      people: strip(backup.data.people),
      transactions: strip(backup.data.transactions),
      settings: strip(backup.data.settings),
      appMetadata: backup.data.appMetadata,
    },
  };
}

describe('backup with sync identity', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('round trips domain data, sync identity, and every derived figure', async () => {
    const { person } = buildFinancialHistory();
    const backup = createBackup();
    const before = snapshot(person.id);

    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    for (const account of backup.data.accounts) expect(isSyncId(account.syncId)).toBe(true);

    // Restore into a different database, as a new install would.
    await setupDatabase();
    restoreBackup(backup);

    expect(createBackup().data).toEqual(backup.data);
    expect(snapshot(person.id)).toEqual(before);
    expect(listAccounts().map((account) => account.syncId)).toEqual(
      backup.data.accounts.map((account) => account.syncId),
    );
  });

  it('excludes deleted records and sync runtime state from the portable file', () => {
    const { cash } = buildFinancialHistory();
    const removed = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 7777,
      title: 'Removed',
      paymentMode: 'cash',
      transactionDate,
    });
    transactionService.deleteTransaction(removed.id);
    updateSyncState({ pullCursor: 42, lastSyncError: 'server_error' });

    const backup = createBackup();
    const serialized = JSON.stringify(backup);

    expect(backup.data.transactions.map((item) => item.id)).not.toContain(removed.id);
    for (const key of [
      'syncOutbox',
      'sync_outbox',
      'syncState',
      'sync_state',
      'pullCursor',
      'attemptCount',
      'lastError',
      'deletedAt',
      'access_token',
      'refresh_token',
      'pinVerifier',
      'pinSalt',
    ]) {
      expect(serialized).not.toContain(key);
    }
  });

  it('leaves restored data waiting for reconciliation rather than queuing an upload', async () => {
    buildFinancialHistory();
    const backup = createBackup();

    await setupDatabase();
    makeAccount('Local only');
    updateSyncState({
      pullCursor: 17,
      lastSuccessfulSyncAt: new Date(),
      lastSuccessfulPushAt: new Date(),
    });
    expect(countPendingSyncMutations()).toBe(1);

    restoreBackup(backup);

    // Restore is not a user mutation and the previous queue no longer applies.
    expect(countPendingSyncMutations()).toBe(0);
    expect(getSyncState()).toMatchObject({
      pullCursor: null,
      lastSuccessfulSyncAt: null,
      lastSuccessfulPushAt: null,
    });
  });

  it('restores a pre-M7C backup by assigning fresh stable identities', async () => {
    buildFinancialHistory();
    const legacy = toLegacyEnvelope(createBackup());

    await setupDatabase();
    const seededCategoryCount = listCategories().length;
    restoreBackup(legacy);

    const categories = listCategories();
    expect(categories).toHaveLength(seededCategoryCount);
    const systemKeys = categories.map((item) => item.systemKey).filter(Boolean);
    expect(new Set(systemKeys).size).toBe(systemKeys.length);

    const restored = createBackup();
    for (const item of [
      ...restored.data.accounts,
      ...restored.data.categories,
      ...restored.data.people,
      ...restored.data.transactions,
      ...restored.data.settings,
    ]) {
      expect(isSyncId(item.syncId)).toBe(true);
    }
    expect(restored.data.transactions).toHaveLength(legacy.data.transactions.length);
    expect(getTotalBalance()).toBe(100000 + 500000 + 80000 - 12000 - 30000);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('rejects a backup that would restore two records onto one cloud identity', () => {
    buildFinancialHistory();
    const backup = createBackup();
    backup.data.accounts[1]!.syncId = backup.data.accounts[0]!.syncId;

    expect(() => validateBackup(backup)).toThrow(/duplicate accounts sync IDs/i);
  });

  it('rejects a malformed sync identity', () => {
    buildFinancialHistory();
    const backup = createBackup();
    backup.data.accounts[0]!.syncId = 'not-a-uuid';

    expect(() => validateBackup(backup)).toThrow(/invalid/i);
  });
});
