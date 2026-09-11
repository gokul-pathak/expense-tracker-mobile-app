import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as budgetService from '@/features/budgets/budget.service';
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  SYNC_BACKUP_FORMAT_VERSION,
  SYNC_BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
  type SyncBackupEnvelope,
} from '@/features/backup/backup.types';
import { getBackupPreview, validateBackup } from '@/features/backup/backup.validation';
import * as categoryService from '@/features/categories/category.service';
import { countPendingSyncMutations, getSyncState } from '@/features/sync/sync.repository';
import { getTotalBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

/**
 * Budgets in a portable backup.
 *
 * A backup carries the plan and not the progress: what was spent is derived from
 * the transactions in the same file, so storing it could only be a way for the
 * file to disagree with itself.
 */

const SEPTEMBER = '2026-09';
const rupees = (amount: number) => amount * 100;

function foodCategory() {
  const category = categoryService.listExpenseCategories().find((item) => item.name === 'Food');
  if (category === undefined) throw new Error('Seed has no Food category.');
  return category;
}

/** Two plans and the spending they measure. */
function buildPlanAndSpending() {
  const cash = makeAccount('Cash', 'NPR', rupees(1_000_000));
  const food = foodCategory();
  const overall = budgetService.createBudget({
    periodMonth: SEPTEMBER,
    amountMinor: rupees(40_000),
  });
  const category = budgetService.createBudget({
    categoryId: food.id,
    periodMonth: SEPTEMBER,
    amountMinor: rupees(15_000),
  });
  transactionService.createExpense({
    accountId: cash.id,
    categoryId: food.id,
    amountMinor: rupees(9_000),
    title: 'Food',
    transactionDate: new Date(2026, 8, 10),
  });
  return { cash, food, overall, category };
}

describe('budgets in a backup', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('round trips the plan, its identity, and the spending derived from it', () => {
    const built = buildPlanAndSpending();
    const before = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
    const balanceBefore = getTotalBalance();

    const backup = createBackup();
    restoreBackup(JSON.parse(JSON.stringify(backup)) as BackupEnvelope);

    const after = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
    expect(after).toEqual(before);
    expect(after.categoryBudgets[0]?.spentMinor).toBe(rupees(9_000));
    expect(getTotalBalance()).toBe(balanceBefore);

    const restored = budgetService.listBudgetsForMonth(SEPTEMBER);
    expect(restored.map((budget) => budget.syncId).sort()).toEqual(
      [built.overall.syncId, built.category.syncId].sort(),
    );
    expect(restored.find((budget) => budget.categoryId !== null)?.categoryId).toBe(built.food.id);
  });

  it('stores the plan and never a spent or remaining figure', () => {
    buildPlanAndSpending();

    const backup = createBackup();

    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.data.budgets).toHaveLength(2);
    for (const budget of backup.data.budgets) {
      expect(Object.keys(budget).sort()).toEqual([
        'amountMinor',
        'categoryId',
        'createdAt',
        'currency',
        'id',
        'periodMonth',
        'syncId',
        'updatedAt',
      ]);
    }
    expect(JSON.stringify(backup)).not.toMatch(/spent|remaining|percentage|overspent/i);
    expect(getBackupPreview(backup).budgets).toBe(2);
  });

  it('excludes a deleted plan, because it is deleted data', () => {
    const built = buildPlanAndSpending();
    budgetService.deleteBudget(built.overall.id);

    const backup = createBackup();

    expect(backup.data.budgets).toHaveLength(1);
    expect(backup.data.budgets[0]!.syncId).toBe(built.category.syncId);
  });

  it('restores an older backup that predates budgets, with no budgets', () => {
    buildPlanAndSpending();
    const legacy = syncEraBackup();

    restoreBackup(legacy);

    // A file written before budgets existed simply has none. That is the truth
    // about that file, not a reason to refuse it.
    expect(budgetService.listBudgets()).toEqual([]);
    expect(budgetService.getMonthlyBudgetSummary(SEPTEMBER).totalBudgetedMinor).toBeNull();
    expect(transactionService.listTransactions()).toHaveLength(1);
  });

  it('refuses a budget-era backup that claims to be the older format', () => {
    const backup = createBackup();
    const mislabelled = {
      ...backup,
      formatVersion: SYNC_BACKUP_FORMAT_VERSION,
      schemaVersion: SYNC_BACKUP_SCHEMA_VERSION,
    };

    // Each version accepts exactly its own shape, so a file cannot claim to be
    // older than the data it carries.
    expect(() => validateBackup(mislabelled)).toThrow(/invalid/);
  });

  it('refuses a backup whose budget points at a category that is not there', () => {
    buildPlanAndSpending();
    const backup = createBackup();
    backup.data.budgets[1]!.categoryId = 9_999;

    expect(() => validateBackup(backup)).toThrow(/missing category/);
  });

  it('refuses a backup whose budget points at an income category', () => {
    buildPlanAndSpending();
    const backup = createBackup();
    const income = backup.data.categories.find((category) => category.type === 'income')!;
    backup.data.budgets[1]!.categoryId = income.id;

    expect(() => validateBackup(backup)).toThrow(/non-expense category/);
  });

  it('refuses a backup holding two plans for one month', () => {
    buildPlanAndSpending();
    const backup = createBackup();
    backup.data.budgets.push({
      ...backup.data.budgets[0]!,
      id: 99,
      syncId: '99999999-9999-4999-8999-999999999999',
    });

    expect(() => validateBackup(backup)).toThrow(/more than one budget/);
  });

  it('leaves a restored dataset waiting for an explicit reconciliation', () => {
    buildPlanAndSpending();
    const backup = createBackup();

    restoreBackup(backup);

    // Restoring is not a user mutation and never queues an upload: an older
    // file must not be able to silently overwrite newer cloud budgets.
    expect(countPendingSyncMutations()).toBe(0);
    const state = getSyncState();
    expect(state?.linkedUserId).toBeNull();
    expect(state?.reconciliationRequired).toBe(true);
  });
});

/** The shape a build between M7C and M8A produced: sync identity, no budgets. */
function syncEraBackup(): SyncBackupEnvelope {
  const current = createBackup();
  const {
    budgets: _budgets,
    recurringTemplates: _templates,
    recurringOccurrences: _occurrences,
    ...data
  } = current.data;
  return {
    format: BACKUP_FORMAT,
    formatVersion: SYNC_BACKUP_FORMAT_VERSION,
    schemaVersion: SYNC_BACKUP_SCHEMA_VERSION,
    createdAt: current.createdAt,
    appVersion: current.appVersion,
    data: {
      ...data,
      transactions: data.transactions.map(({ recurringOccurrenceId: _link, ...rest }) => rest),
    },
  };
}
