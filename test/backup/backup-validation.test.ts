import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  LEGACY_BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
  type LegacyBackupEnvelope,
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
          syncId: '11111111-1111-4111-8111-111111111111',
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
          syncId: '22222222-2222-4222-8222-222222222222',
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
          syncId: '33333333-3333-4333-8333-333333333333',
          name: 'Salary',
          type: 'income',
          icon: null,
          systemKey: 'income_salary',
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      people: [
        {
          id: 1,
          syncId: '44444444-4444-4444-8444-444444444444',
          name: 'राम',
          note: null,
          isArchived: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      settings: [
        {
          id: 1,
          syncId: '55555555-5555-4555-8555-555555555555',
          defaultCurrency: 'NPR',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      budgets: [
        {
          id: 1,
          syncId: '99999999-9999-4999-8999-999999999999',
          categoryId: 1,
          periodMonth: '2026-09',
          amountMinor: 1500000,
          currency: 'NPR',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      recurringTemplates: [],
      recurringOccurrences: [],
      appMetadata: [{ key: 'seed.categories.version', value: '1' }],
      transactions: [
        {
          id: 1,
          syncId: '66666666-6666-4666-8666-666666666666',
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
          recurringOccurrenceId: null,
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
    duplicate.data.accounts.push({
      ...duplicate.data.accounts[0]!,
      id: 1,
      syncId: '77777777-7777-4777-8777-777777777777',
    });
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
    settings.data.settings.push({
      ...settings.data.settings[0]!,
      syncId: '88888888-8888-4888-8888-888888888888',
    });
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
  it('rejects cloud authentication sessions in the portable backup envelope', () => {
    const backup = fixture() as BackupEnvelope & { session?: { access_token: string } };
    backup.session = { access_token: 'never-exported' };
    expect(() => validateBackup(backup)).toThrow('invalid');
  });
});

/** The pre-M7C shape a released build produced, without global sync identity. */
function legacyFixture(): LegacyBackupEnvelope {
  const current = fixture();
  const strip = <T extends { syncId: string }>(items: T[]) =>
    items.map(({ syncId: _syncId, ...rest }) => rest);
  return {
    format: BACKUP_FORMAT,
    formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
    schemaVersion: LEGACY_BACKUP_SCHEMA_VERSION,
    createdAt: current.createdAt,
    appVersion: current.appVersion,
    data: {
      accounts: strip(current.data.accounts),
      categories: strip(current.data.categories),
      people: strip(current.data.people),
      transactions: strip(current.data.transactions).map(
        ({ recurringOccurrenceId: _link, ...rest }) => rest,
      ),
      settings: strip(current.data.settings),
      appMetadata: current.data.appMetadata,
    },
  };
}

describe('backup format versions', () => {
  it('still accepts a pre-M7C backup', () => {
    const legacy = validateBackup(legacyFixture());
    expect(legacy.formatVersion).toBe(LEGACY_BACKUP_FORMAT_VERSION);
    expect(getBackupPreview(legacy)).toMatchObject({ accounts: 1, transactions: 1 });
  });
  it('rejects a pre-M7C backup that smuggles in sync identity', () => {
    const legacy = legacyFixture() as unknown as {
      data: { accounts: Record<string, unknown>[] };
    };
    legacy.data.accounts[0]!.syncId = '11111111-1111-4111-8111-111111111111';
    expect(() => validateBackup(legacy)).toThrow('invalid');
  });
  it('requires sync identity in a current backup', () => {
    const current = fixture() as unknown as { data: { accounts: Record<string, unknown>[] } };
    delete current.data.accounts[0]!.syncId;
    expect(() => validateBackup(current)).toThrow('invalid');
  });
  it('rejects a malformed sync identity', () => {
    const current = fixture();
    current.data.accounts[0]!.syncId = '1234';
    expect(() => validateBackup(current)).toThrow('invalid');
  });
  it('rejects the same sync identity used by two records', () => {
    const current = fixture();
    current.data.categories[1]!.syncId = current.data.categories[0]!.syncId;
    expect(() => validateBackup(current)).toThrow('duplicate');
  });
});
