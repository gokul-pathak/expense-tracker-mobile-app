import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
} from '@/features/backup/backup.types';
import {
  getBackupPreview,
  parseBackupJson,
  validateBackup,
} from '@/features/backup/backup.validation';

function fixture(): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: '2026-09-07T10:00:00.000Z',
    appVersion: '0.1.0',
    data: {
      accounts: [
        {
          id: 1,
          name: 'Cash',
          type: 'cash',
          openingBalanceMinor: 0,
          currency: 'NPR',
          icon: null,
          isArchived: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      categories: [
        {
          id: 1,
          name: 'Food',
          type: 'expense',
          icon: null,
          systemKey: 'expense_food',
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 2,
          name: 'Salary',
          type: 'income',
          icon: null,
          systemKey: 'income_salary',
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      people: [{ id: 1, name: 'राम', note: null, isArchived: false, createdAt: 1, updatedAt: 1 }],
      settings: [{ id: 1, defaultCurrency: 'NPR', createdAt: 1, updatedAt: 1 }],
      appMetadata: [{ key: 'seed.categories.version', value: '1' }],
      transactions: [
        {
          id: 1,
          type: 'expense',
          amountMinor: 1299,
          currency: 'NPR',
          categoryId: 1,
          sourceAccountId: 1,
          destinationAccountId: null,
          personId: null,
          paymentMode: 'cash',
          transactionDate: 1,
          title: 'Dinner',
          note: 'Dinner, drinks',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
  };
}

describe('backup validation', () => {
  it('rejects malformed JSON before a restore can begin', () => {
    expect(() => parseBackupJson('{ invalid')).toThrow('not valid JSON');
  });
  it('accepts a valid backup and produces a preview', () => {
    const backup = validateBackup(fixture());
    expect(getBackupPreview(backup)).toMatchObject({
      accounts: 1,
      transactions: 1,
      currency: 'NPR',
    });
  });
  it('rejects unknown formats and versions', () => {
    const wrong = fixture();
    (wrong as { format: string }).format = 'wrong-app';
    expect(() => validateBackup(wrong)).toThrow('invalid');
    const newer = fixture();
    (newer as { formatVersion: number }).formatVersion = 999;
    expect(() => validateBackup(newer)).toThrow('newer');
  });
  it('rejects missing fields, duplicate IDs, and invalid monetary values', () => {
    const missing = fixture() as unknown as { data: Record<string, unknown> };
    delete missing.data.transactions;
    expect(() => validateBackup(missing)).toThrow('invalid');
    const duplicate = fixture();
    duplicate.data.accounts.push({ ...duplicate.data.accounts[0]!, id: 1 });
    expect(() => validateBackup(duplicate)).toThrow('duplicate');
    const money = fixture();
    money.data.transactions[0]!.amountMinor = 12.99;
    expect(() => validateBackup(money)).toThrow('invalid');
  });
  it('rejects broken references, same-account transfers, and overpayments', () => {
    const reference = fixture();
    reference.data.transactions[0]!.sourceAccountId = 99;
    expect(() => validateBackup(reference)).toThrow('missing source');
    const transfer = fixture();
    transfer.data.transactions[0] = {
      ...transfer.data.transactions[0]!,
      type: 'transfer',
      categoryId: null,
      sourceAccountId: 1,
      destinationAccountId: 1,
      paymentMode: null,
    };
    expect(() => validateBackup(transfer)).toThrow('transfer');
    const debt = fixture();
    debt.data.transactions = [
      {
        ...debt.data.transactions[0]!,
        type: 'repayment_received',
        categoryId: null,
        sourceAccountId: null,
        destinationAccountId: 1,
        personId: 1,
        paymentMode: null,
      },
    ];
    expect(() => validateBackup(debt)).toThrow('repayments');
  });
  it('requires exactly one settings record and valid enums', () => {
    const settings = fixture();
    settings.data.settings.push({ ...settings.data.settings[0]! });
    expect(() => validateBackup(settings)).toThrow('duplicate settings');
    const enumValue = fixture() as unknown as { data: { accounts: Array<{ type: string }> } };
    enumValue.data.accounts[0]!.type = 'invalid';
    expect(() => validateBackup(enumValue)).toThrow('invalid');
  });
  it('rejects non-normalized currency codes', () => {
    const backup = fixture();
    backup.data.accounts[0]!.currency = 'npr';
    expect(() => validateBackup(backup)).toThrow('invalid');
  });
  it('rejects security credentials in the portable backup envelope', () => {
    const backup = fixture() as BackupEnvelope & { pinVerifier?: string };
    backup.pinVerifier = 'never-exported';
    expect(() => validateBackup(backup)).toThrow('invalid');
  });
});
