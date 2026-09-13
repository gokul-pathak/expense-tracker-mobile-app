import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

/**
 * The app's cache directory, in memory: each file's URI and when it was last
 * written, plus a switch that makes deleting fail.
 *
 * The real `receipt-files` module runs against it, so what is tested is the
 * sweep the app ships — not a stand-in for it.
 */
const disk = vi.hoisted(() => ({ files: new Map<string, number>(), failDelete: false }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: async (uri: string) => {
    if (uri === 'file:///cache/receipt-processing/') return { exists: true, isDirectory: true };
    const modified = disk.files.get(uri);
    return modified === undefined
      ? { exists: false }
      : { exists: true, isDirectory: false, size: 1, modificationTime: modified / 1000 };
  },
  readDirectoryAsync: async (path: string) =>
    [...disk.files.keys()]
      .filter((uri) => uri.startsWith(path))
      .map((uri) => uri.slice(path.length)),
  deleteAsync: async (uri: string) => {
    if (disk.failDelete) throw new Error('storage unavailable');
    disk.files.delete(uri);
  },
  makeDirectoryAsync: async () => undefined,
  copyAsync: async ({ to }: { from: string; to: string }) => {
    disk.files.set(to, Date.now());
  },
}));

import { getReceiptDraft } from '@/features/receipts/receipt-draft.repository';
import * as processing from '@/features/receipts/receipt-processing.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory } from '../recurring/fixture';
import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

/**
 * A receipt photo is temporary even when housekeeping fails.
 *
 * Deleting a photo can fail quietly, and the app can be killed between copying
 * a photo in and registering its draft. Either way the file belongs to no draft
 * and nothing would ever look for it again. The draft sweep's second pass finds
 * those files — and only those, and only once they are as old as a draft could
 * be, so a live review or a capture still being registered is never touched.
 */

const DIRECTORY = 'file:///cache/receipt-processing/';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 13, 10);

const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('receipt photos no draft owns', () => {
  beforeEach(async () => {
    await setupDatabase();
    disk.files.clear();
    disk.failDelete = false;
  });
  afterAll(() => closeTestDatabase());

  it('are removed once they are older than any draft, and not before', async () => {
    const abandoned = `${DIRECTORY}killed-before-register.jpg`;
    const arriving = `${DIRECTORY}being-registered.jpg`;
    disk.files.set(abandoned, at(-8).getTime());
    disk.files.set(arriving, NOW.getTime() - 60_000);

    await processing.cleanupExpiredReceiptDrafts(NOW);

    expect(disk.files.has(abandoned)).toBe(false);
    expect(disk.files.has(arriving)).toBe(true);
  });

  it('never include the photo of a draft still waiting, however old the file is', async () => {
    const photo = `${DIRECTORY}taken-last-month.jpg`;
    disk.files.set(photo, at(-30).getTime());
    const draft = processing.registerCapturedReceipt(photo, NOW);

    await processing.cleanupExpiredReceiptDrafts(NOW);

    expect(disk.files.has(photo)).toBe(true);
    expect(getReceiptDraft(draft.id)).not.toBeNull();
  });

  it('include a photo whose delete failed when its draft was discarded', async () => {
    const photo = `${DIRECTORY}discarded.jpg`;
    disk.files.set(photo, NOW.getTime());
    const draft = processing.registerCapturedReceipt(photo, NOW);

    disk.failDelete = true;
    await processing.discardReceiptDraft(draft.id);
    disk.failDelete = false;

    // The draft is gone and the photo was left behind, owned by nothing.
    expect(getReceiptDraft(draft.id)).toBeNull();
    expect(disk.files.has(photo)).toBe(true);

    await processing.cleanupExpiredReceiptDrafts(at(2));
    expect(disk.files.has(photo)).toBe(true);

    await processing.cleanupExpiredReceiptDrafts(at(8));
    expect(disk.files.has(photo)).toBe(false);
  });

  it('are swept without reaching a balance, a transaction or the outbox', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory('Food').id,
      amountMinor: 101_700,
      transactionDate: new Date(2026, 8, 12, 12),
    });
    const balance = getAccountBalance(cash.id);
    const pending = countPendingSyncMutations();
    disk.files.set(`${DIRECTORY}abandoned.jpg`, at(-10).getTime());

    await processing.cleanupExpiredReceiptDrafts(NOW);

    expect(disk.files.size).toBe(0);
    expect(getAccountBalance(cash.id)).toBe(balance);
    expect(countPendingSyncMutations()).toBe(pending);
  });

  it('do not stop the draft sweep when the directory cannot be read', async () => {
    const photo = `${DIRECTORY}expired.jpg`;
    disk.files.set(photo, at(-10).getTime());
    const draft = processing.registerCapturedReceipt(photo, at(-10));
    disk.failDelete = true;

    // Deleting fails throughout; the expired draft row still goes.
    await expect(processing.cleanupExpiredReceiptDrafts(NOW)).resolves.toBe(1);
    expect(getReceiptDraft(draft.id)).toBeNull();
  });
});
