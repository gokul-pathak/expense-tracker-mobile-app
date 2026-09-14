import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import { createReceiptDraft } from '@/features/receipts/receipt-draft.repository';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

import { buildEverything, logicalState } from './fixture';

/**
 * A backup of everything a person can own, restored into a clean database.
 *
 * What is compared is meaning — every balance, Home, the month's report, budgets,
 * schedules and the portfolio, keyed by global identity — so a restore that kept
 * every row but changed a figure would still fail.
 */

type Json = Record<string, unknown> & { [key: string]: any };

function count(table: string): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table}`).get();
  return Number((row as { total: number }).total);
}

describe('a backup of everything', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('restores into a clean database with every record and every derived figure identical', async () => {
    buildEverything();
    createReceiptDraft('file:///private/receipt-photo.jpg', new Date(2026, 9, 1));
    const before = logicalState();
    const text = JSON.stringify(createBackup());

    await setupDatabase();
    restoreBackup(JSON.parse(text));

    expect(logicalState()).toEqual(before);
    // A restore is not a user edit: nothing is queued, and no draft appears.
    expect(countPendingSyncMutations()).toBe(0);
    expect(count('receipt_drafts')).toBe(0);
  });

  it('carries source records only — no lock, session, sync state, receipt or AI material', () => {
    buildEverything();
    createReceiptDraft('file:///private/receipt-photo.jpg', new Date(2026, 9, 1));
    expect(countPendingSyncMutations()).toBeGreaterThan(0);

    const backup = createBackup();
    const text = JSON.stringify(backup);

    expect(Object.keys(backup).sort()).toEqual([
      'appVersion',
      'createdAt',
      'data',
      'format',
      'formatVersion',
      'schemaVersion',
    ]);
    expect(Object.keys(backup.data).sort()).toEqual([
      'accounts',
      'appMetadata',
      'budgets',
      'categories',
      'investmentAssets',
      'investmentPrices',
      'investmentTrades',
      'people',
      'recurringOccurrences',
      'recurringTemplates',
      'settings',
      'transactions',
    ]);
    expect(text).not.toContain('receipt-photo');
    expect(text).not.toMatch(
      /"(pin|pinVerifier|verifier|salt|accessToken|access_token|refreshToken|refresh_token|session)"\s*:/i,
    );
    expect(text).not.toMatch(
      /"(outbox|cursor|lastPulledSequence|baseline|linkedUserId|syncState|conflicts?)"\s*:/i,
    );
    expect(text).not.toMatch(
      /"(prompt|suggestion|explanation|ocrText|rawText|imageUri|parsedFields)"\s*:/i,
    );
    // No derived figure travels either.
    expect(text).not.toMatch(
      /"(balanceMinor|spentMinor|remainingMinor|costBasisMinor|realizedGainMinor|marketValueMinor)"\s*:/,
    );
  });

  it('refuses a damaged backup before changing anything in a healthy database', () => {
    buildEverything();
    const healthy = logicalState();
    const valid = JSON.parse(JSON.stringify(createBackup())) as Json;

    const damage: [string, (data: Json) => void][] = [
      [
        'a transaction paying from an account that does not exist',
        (data) => {
          const expense = data.transactions.find((row: Json) => row.type === 'expense');
          expense.sourceAccountId = 999_999;
        },
      ],
      [
        'an amount beyond the safe integer range',
        (data) => {
          data.transactions[0].amountMinor = Number.MAX_SAFE_INTEGER + 1;
        },
      ],
      [
        'one identity used by two accounts',
        (data) => {
          data.accounts[1].syncId = data.accounts[0].syncId;
        },
      ],
      [
        'an unknown transaction type',
        (data) => {
          data.transactions[0].type = 'gift';
        },
      ],
      [
        'a negative investment quantity',
        (data) => {
          data.investmentTrades.find((row: Json) => row.tradeType === 'buy').quantityMinor = -5;
        },
      ],
      [
        'a recurring date with a status that does not exist',
        (data) => {
          data.recurringOccurrences[0].status = 'maybe';
        },
      ],
    ];

    for (const [label, corrupt] of damage) {
      const copy = JSON.parse(JSON.stringify(valid)) as Json;
      corrupt(copy.data);
      expect(() => restoreBackup(copy as never), label).toThrow();
      expect(logicalState(), label).toEqual(healthy);
    }
  });
});
