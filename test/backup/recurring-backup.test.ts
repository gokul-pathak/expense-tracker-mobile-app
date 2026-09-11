import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import {
  createBackup,
  parseAndValidateBackup,
  readBackupData,
  restoreBackup,
} from '@/features/backup/backup.service';
import {
  BUDGET_BACKUP_FORMAT_VERSION,
  BUDGET_BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
} from '@/features/backup/backup.types';
import { getBackupPreview, validateBackup } from '@/features/backup/backup.validation';
import * as recurring from '@/features/recurring/recurring.service';
import { getSyncState, countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

import {
  buildRecurringFixture,
  createGroceryRun,
  createSalary,
  rupees,
  type RecurringFixture,
} from '../recurring/fixture';

/**
 * Recurring data in a backup.
 *
 * A backup carries the schedule and the decisions — which dates were generated
 * and which skipped — and never what is due. What is due is recomputed from
 * those after a restore, and must come out the same; a stored due list could
 * only be a way for the file to disagree with itself.
 */

const AS_OF = '2026-09-20';
let fixture: RecurringFixture;

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function dueList() {
  return recurring
    .listDueOccurrences({ asOfDate: AS_OF })
    .occurrences.map((item) => [item.templateSyncId, item.occurrenceDate]);
}

/** What the backup holds, as JSON text and back, exactly as a file would. */
function roundTrip(backup: BackupEnvelope) {
  return parseAndValidateBackup(JSON.stringify(backup));
}

describe('recurring data in a backup', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('round trips templates, decisions and links, and the due list comes out the same', () => {
    const food = createGroceryRun(fixture);
    const salary = createSalary(fixture);
    const june = recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.skipOccurrence(food.id, '2026-07-15', { asOfDate: AS_OF });
    const august = recurring.generateOccurrence(food.id, '2026-08-15', { asOfDate: AS_OF });
    // Deleted afterwards: the date stays handled even though its transaction is gone.
    transactionService.deleteTransaction(august.transactionId!);
    recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });

    const due = dueList();
    const balance = getAccountBalance(fixture.bank.id);
    const templateIds = recurring
      .listRecurringTemplates()
      .map((item) => item.syncId)
      .sort();
    const backup = createBackup();

    restoreBackup(roundTrip(backup));

    expect(
      recurring
        .listRecurringTemplates()
        .map((item) => item.syncId)
        .sort(),
    ).toEqual(templateIds);
    expect(dueList()).toEqual(due);
    expect(getAccountBalance(fixture.bank.id)).toBe(balance);
    expect(count('recurring_occurrences')).toBe(4);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(2);
    // Generating a handled date again is still recognised as already done.
    const again = recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    expect(again.outcome).toBe('already_generated');
    expect(again.transactionId).not.toBeNull();
    expect(again.occurrence.syncId).toBe(june.occurrence.syncId);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(2);
  });

  it('stores the schedule and the decisions, never what is due', () => {
    const food = createGroceryRun(fixture);
    recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });

    const data = readBackupData();
    const text = JSON.stringify(data);

    expect(Object.keys(data.recurringTemplates[0]!).sort()).toEqual(
      [
        'id',
        'syncId',
        'type',
        'amountMinor',
        'currency',
        'categoryId',
        'accountId',
        'paymentMode',
        'title',
        'note',
        'startDate',
        'frequency',
        'interval',
        'endDate',
        'isPaused',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(text).not.toMatch(/nextDue|dueDate|"due"/i);
    expect(data.recurringOccurrences).toHaveLength(1);
    expect(getBackupPreview(createBackup()).recurringTemplates).toBe(1);
  });

  it('keeps a deleted template’s transactions as ordinary ones and drops its history', () => {
    const food = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.deleteRecurringTemplate(food.id);

    const data = readBackupData();

    expect(data.recurringTemplates).toEqual([]);
    expect(data.recurringOccurrences).toEqual([]);
    const transaction = data.transactions.find((item) => item.id === generated.transactionId);
    expect(transaction).toMatchObject({ amountMinor: rupees(5_000), recurringOccurrenceId: null });
    // And that backup restores.
    expect(() => restoreBackup(roundTrip(createBackup()))).not.toThrow();
    expect(transactionService.getTransaction(generated.transactionId!).amountMinor).toBe(
      rupees(5_000),
    );
  });

  it('restores as local data that queues nothing and waits for a reconciliation', () => {
    const food = createGroceryRun(fixture);
    recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    const backup = createBackup();

    restoreBackup(roundTrip(backup));

    expect(countPendingSyncMutations()).toBe(0);
    expect(getSyncState()?.reconciliationRequired).toBe(true);
  });

  it('restores a budget-era backup, which simply has no recurring data', () => {
    const current = createBackup();
    const {
      recurringTemplates: _templates,
      recurringOccurrences: _occurrences,
      ...rest
    } = current.data;
    const older = {
      ...current,
      formatVersion: BUDGET_BACKUP_FORMAT_VERSION,
      schemaVersion: BUDGET_BACKUP_SCHEMA_VERSION,
      data: {
        ...rest,
        transactions: rest.transactions.map(
          ({ recurringOccurrenceId: _link, ...transaction }) => transaction,
        ),
      },
    };
    createGroceryRun(fixture);

    restoreBackup(validateBackup(JSON.parse(JSON.stringify(older))));

    expect(count('recurring_templates')).toBe(0);
    expect(count('recurring_occurrences')).toBe(0);
  });

  it('refuses an occurrence whose identity does not match its template and date', () => {
    const food = createGroceryRun(fixture);
    recurring.skipOccurrence(food.id, '2026-07-15', { asOfDate: AS_OF });
    const backup = createBackup();
    backup.data.recurringOccurrences[0]!.occurrenceDate = '2026-08-15';

    expect(() => validateBackup(JSON.parse(JSON.stringify(backup)))).toThrow(/identity/);
  });

  it('refuses a generated transaction whose identity does not match its occurrence', () => {
    const food = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    const backup = createBackup();
    const transaction = backup.data.transactions.find(
      (item) => item.id === generated.transactionId,
    )!;
    transaction.syncId = '77777777-7777-4777-8777-777777777777';

    expect(() => validateBackup(JSON.parse(JSON.stringify(backup)))).toThrow(/identity/);
  });

  it('refuses two transactions for one occurrence', () => {
    const food = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(food.id, '2026-06-15', { asOfDate: AS_OF });
    const backup = createBackup();
    const original = backup.data.transactions.find((item) => item.id === generated.transactionId)!;
    backup.data.transactions.push({
      ...original,
      id: 9_999,
      syncId: '88888888-8888-4888-8888-888888888888',
    });

    expect(() => validateBackup(JSON.parse(JSON.stringify(backup)))).toThrow();
  });

  it('refuses an occurrence of a template the backup does not contain', () => {
    const food = createGroceryRun(fixture);
    recurring.skipOccurrence(food.id, '2026-07-15', { asOfDate: AS_OF });
    const backup = createBackup();
    backup.data.recurringTemplates = [];

    expect(() => validateBackup(JSON.parse(JSON.stringify(backup)))).toThrow(/missing template/);
  });
});
