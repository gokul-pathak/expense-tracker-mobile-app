import { describe, expect, it } from 'vitest';

import type { BackupData } from '@/features/backup/backup.types';
import { formatMinorForCsv, transactionsToCsv } from '@/features/export/export.types';

const data: BackupData = {
  accounts: [
    {
      id: 1,
      syncId: '11111111-1111-4111-8111-111111111111',
      name: 'Cash, Café',
      type: 'cash',
      openingBalanceMinor: 0,
      currency: 'NPR',
      icon: null,
      isArchived: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  categories: [
    {
      id: 1,
      syncId: '22222222-2222-4222-8222-222222222222',
      name: 'Food',
      type: 'expense',
      icon: null,
      systemKey: null,
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  people: [
    {
      id: 1,
      syncId: '44444444-4444-4444-8444-444444444444',
      name: 'राम',
      note: null,
      isArchived: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  settings: [
    {
      id: 1,
      syncId: '55555555-5555-4555-8555-555555555555',
      defaultCurrency: 'NPR',
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  appMetadata: [],
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
      personId: 1,
      paymentMode: 'cash',
      transactionDate: 0,
      title: 'He said "hello"',
      note: 'Dinner,\ndrinks',
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

describe('transaction CSV export', () => {
  it('uses complete headers, exact money, and RFC-style escaping', () => {
    const csv = transactionsToCsv(data);
    expect(csv).toContain('amount,amount_minor');
    expect(csv).toContain('12.99,1299');
    expect(csv).toContain('"Cash, Café"');
    expect(csv).toContain('"He said ""hello"""');
    expect(csv).toContain('"Dinner,\ndrinks"');
    expect(csv).toContain('राम');
  });
  it('formats minor units without float arithmetic', () => {
    expect(formatMinorForCsv(1)).toBe('0.01');
    expect(formatMinorForCsv(1299)).toBe('12.99');
    expect(formatMinorForCsv(-1299)).toBe('-12.99');
  });
});
