import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

/**
 * The staged-image layer, replaced by an in-memory set.
 *
 * Real file system behaviour is not what these tests are about; what matters
 * is that the service asks whether the image is still there, and behaves when
 * the answer is no. The OS empties caches without warning, so "no" is an
 * ordinary answer.
 */
const files = new Set<string>();
vi.mock('@/features/receipts/capture/receipt-files', () => ({
  stageReceiptFile: async (uri: string) => uri,
  receiptFileExists: async (uri: string) => files.has(uri),
  receiptFileSize: async () => undefined,
  deleteReceiptFile: async (uri: string) => {
    files.delete(uri);
  },
  deleteStaleReceiptFiles: async () => 0,
  clearReceiptWorkingDirectory: async () => {
    files.clear();
  },
}));

import { getTotalBalance } from '@/features/transactions/account-balance.service';
import {
  resetReceiptOcrProvider,
  setReceiptOcrProvider,
  type ReceiptOcrProvider,
} from '@/features/receipts/ocr/receipt-ocr';
import * as processing from '@/features/receipts/receipt-processing.service';
import * as repository from '@/features/receipts/receipt-draft.repository';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient, reopenTestDatabase } from '../support/test-database';

/**
 * Receipt processing, end to end, without a camera or an OCR engine.
 *
 * Everything below runs against real SQLite and a fake provider that returns
 * fixture text. That is the point of the provider abstraction: the pipeline is
 * fully exercisable on a laptop, so its guarantees are tested rather than
 * asserted in a document.
 */

const IMAGE = 'file:///private/receipt-processing/abc.jpg';

const RECEIPT_TEXT = `ABC STORE
12 SEP 2026
SUBTOTAL 900.00
VAT 117.00
TOTAL NPR 1,017.00`;

/** A provider that reads whatever it is told to read, whenever it is told to finish. */
function fakeProvider(text: string | (() => Promise<string>), id = 'fake-ocr'): ReceiptOcrProvider {
  return {
    id,
    getCapability: async () => ({ status: 'available' }),
    recognize: async () => {
      const resolved = typeof text === 'string' ? text : await text();
      return { text: resolved, lines: resolved.split('\n'), provider: id };
    },
  };
}

describe('processing a captured receipt', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
    setReceiptOcrProvider(fakeProvider(RECEIPT_TEXT));
  });
  afterEach(() => resetReceiptOcrProvider());
  afterAll(() => closeTestDatabase());

  it('stores the extracted candidates and nothing else', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    expect(created.status).toBe('captured');

    const outcome = await processing.processReceiptDraft(created.id);
    expect(outcome.status).toBe('ready_for_review');

    const draft = repository.getReceiptDraft(created.id)!;
    expect(draft.status).toBe('ready_for_review');
    expect(draft.amountMinor).toBe(101_700);
    expect(draft.currency).toBe('NPR');
    expect(draft.transactionDate).toBe('2026-09-12');
    expect(draft.merchantName).toBe('ABC STORE');
    expect(draft.ocrProvider).toBe('fake-ocr');
    expect(draft.confidence?.amount?.confidence).toBe('high');
  });

  it('keeps the raw OCR text out of the database entirely', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    const stored = JSON.stringify(repository.getReceiptDraft(created.id));
    // The candidates survive; the page they were read from does not.
    expect(stored).not.toContain('SUBTOTAL');
    expect(stored).not.toContain('VAT');
    expect(stored).not.toContain('900');
  });

  it('reports an unreadable photograph as a failure, never a zero draft', async () => {
    setReceiptOcrProvider(fakeProvider('   \n  \n'));
    const created = processing.registerCapturedReceipt(IMAGE);

    const outcome = await processing.processReceiptDraft(created.id);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_text_detected' });
    const draft = repository.getReceiptDraft(created.id)!;
    expect(draft.status).toBe('failed');
    // An expense of 0.00 is a lie that looks like data.
    expect(draft.amountMinor).toBeNull();
  });

  it('reports a missing image rather than crashing', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    files.delete(IMAGE); // The OS reclaimed the cache.

    const outcome = await processing.processReceiptDraft(created.id);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'image_unavailable' });
  });

  it('reports an absent OCR engine as a state, not an exception', async () => {
    resetReceiptOcrProvider(); // The default: no engine in this build.
    const created = processing.registerCapturedReceipt(IMAGE);

    const outcome = await processing.processReceiptDraft(created.id);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'ocr_provider_unavailable' });
  });

  it('turns a provider error into a failure without carrying its message', async () => {
    setReceiptOcrProvider({
      id: 'exploding',
      getCapability: async () => ({ status: 'available' }),
      recognize: async () => {
        throw new Error('decode failed for /private/receipt-processing/abc.jpg');
      },
    });
    const created = processing.registerCapturedReceipt(IMAGE);

    const outcome = await processing.processReceiptDraft(created.id);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'ocr_failed' });
    // The path the provider quoted is not stored anywhere.
    expect(JSON.stringify(repository.getReceiptDraft(created.id))).not.toContain('decode failed');
  });

  it('retries the same staged image without asking for a new photograph', async () => {
    setReceiptOcrProvider(fakeProvider(''));
    const created = processing.registerCapturedReceipt(IMAGE);
    expect((await processing.processReceiptDraft(created.id)).status).toBe('failed');

    setReceiptOcrProvider(fakeProvider(RECEIPT_TEXT));
    const retried = await processing.processReceiptDraft(created.id);

    expect(retried.status).toBe('ready_for_review');
    expect(repository.getReceiptDraft(created.id)!.amountMinor).toBe(101_700);
  });
});

describe('two runs racing over one draft', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
  });
  afterEach(() => resetReceiptOcrProvider());

  it('lets the newer result win, however late the older one finishes', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);

    // Receipt A starts, and will not finish until we let it.
    let releaseA: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    setReceiptOcrProvider(
      fakeProvider(async () => {
        await blocked;
        return 'OLD SHOP\nTOTAL 111.00';
      }, 'slow'),
    );
    const runA = processing.processReceiptDraft(created.id);

    // Receipt B replaces it and finishes first.
    setReceiptOcrProvider(fakeProvider('NEW SHOP\nTOTAL 222.00', 'fast'));
    const runB = await processing.processReceiptDraft(created.id);
    expect(runB.status).toBe('ready_for_review');

    releaseA();
    const outcomeA = await runA;

    // A started first and returned last. Its result is dropped.
    expect(outcomeA.status).toBe('superseded');
    const draft = repository.getReceiptDraft(created.id)!;
    expect(draft.amountMinor).toBe(22_200);
    expect(draft.merchantName).toBe('NEW SHOP');
  });
});

describe('a receipt changes no money', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
    setReceiptOcrProvider(fakeProvider(RECEIPT_TEXT));
  });
  afterEach(() => resetReceiptOcrProvider());

  it('leaves balances, transactions and the outbox exactly as they were', async () => {
    const { makeAccount } = await import('../support/domain');
    makeAccount('Cash', 'NPR', 500_000);

    const balanceBefore = getTotalBalance();
    const pendingBefore = countPendingSyncMutations();
    const transactionsBefore = countTransactions();

    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);
    await processing.discardReceiptDraft(created.id);

    // Scanning, extracting and discarding: all of it, and not one unit moved.
    expect(getTotalBalance()).toEqual(balanceBefore);
    expect(countTransactions()).toBe(transactionsBefore);
    expect(countPendingSyncMutations()).toBe(pendingBefore);
  });

  it('creates no sync work of any kind for the draft itself', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    // A receipt draft is local processing state. Nothing about it is uploaded.
    expect(countPendingSyncMutations()).toBe(0);
  });
});

describe('drafts across a restart and a sweep', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
    setReceiptOcrProvider(fakeProvider(RECEIPT_TEXT));
  });
  afterEach(() => resetReceiptOcrProvider());

  it('recovers a draft after the app restarts', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    reopenTestDatabase();

    const recovered = repository.getReceiptDraft(created.id)!;
    expect(recovered.status).toBe('ready_for_review');
    expect(recovered.amountMinor).toBe(101_700);
  });

  it('reports a draft whose image the cache evicted, without inventing a reading', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    reopenTestDatabase();
    files.delete(IMAGE);

    const outcome = await processing.processReceiptDraft(created.id);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'image_unavailable' });
    expect(repository.getReceiptDraft(created.id)!.amountMinor).toBeNull();
  });

  it('sweeps expired drafts and their images, and leaves everything else alone', async () => {
    const { makeAccount } = await import('../support/domain');
    makeAccount('Cash', 'NPR', 500_000);
    const balanceBefore = getTotalBalance();

    const created = processing.registerCapturedReceipt(IMAGE, new Date(2026, 0, 1));
    await processing.processReceiptDraft(created.id);

    const removed = await processing.cleanupExpiredReceiptDrafts(new Date(2026, 6, 1));

    expect(removed).toBe(1);
    expect(repository.getReceiptDraft(created.id)).toBeNull();
    expect(files.has(IMAGE)).toBe(false);
    expect(getTotalBalance()).toEqual(balanceBefore);
  });

  it('never sweeps a draft that is still being reviewed', async () => {
    const created = processing.registerCapturedReceipt(IMAGE, new Date(2026, 0, 1));
    await processing.processReceiptDraft(created.id);

    // Someone opened it. Its expiry moves with them.
    processing.keepReceiptDraftAlive(created.id, new Date(2026, 6, 1));
    const removed = await processing.cleanupExpiredReceiptDrafts(new Date(2026, 6, 2));

    expect(removed).toBe(0);
    expect(repository.getReceiptDraft(created.id)).not.toBeNull();
  });
});

function countTransactions(): number {
  const row = rawClient().prepare('SELECT count(*) AS total FROM transactions').get() as {
    total: number;
  };
  return row.total;
}
