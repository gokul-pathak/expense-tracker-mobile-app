import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

const files = new Set<string>();
vi.mock('@/features/receipts/capture/receipt-files', () => ({
  stageReceiptFile: async (uri: string) => uri,
  receiptFileExists: async (uri: string) => files.has(uri),
  receiptFileSize: async () => undefined,
  deleteReceiptFile: async (uri: string) => {
    files.delete(uri);
  },
  deleteStaleReceiptFiles: async () => 0,
  clearReceiptWorkingDirectory: async () => {},
}));

import { assertSyncFoundationReady } from '@/db/sync-integrity';
import { SYNC_ENTITY_TYPES } from '@/db/schema';
import { createBackup } from '@/features/backup/backup.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import {
  resetReceiptOcrProvider,
  setReceiptOcrProvider,
} from '@/features/receipts/ocr/receipt-ocr';
import * as processing from '@/features/receipts/receipt-processing.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

/**
 * The promises M9A makes about where a receipt does *not* go.
 *
 * A receipt is a photograph of a piece of paper that also carries an address,
 * a phone number, a loyalty ID and the last four digits of a card. This
 * milestone keeps all of it on the device. These tests are how that stays
 * true when someone later adds a table to the backup or an entity to the sync
 * feed without thinking about receipts.
 */

const IMAGE = 'file:///private/receipt-processing/secret-receipt.jpg';

const RECEIPT_TEXT = `PRIVATE CLINIC
Phone: 9812345678
VAT NO 601234567
12 SEP 2026
TOTAL NPR 4,500.00
VISA ****4321`;

function fakeOcr() {
  setReceiptOcrProvider({
    id: 'fake-ocr',
    getCapability: async () => ({ status: 'available' }),
    recognize: async () => ({
      text: RECEIPT_TEXT,
      lines: RECEIPT_TEXT.split('\n'),
      provider: 'fake-ocr',
    }),
  });
}

describe('a receipt never leaves the device', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
    fakeOcr();
  });
  afterEach(() => resetReceiptOcrProvider());
  afterAll(() => closeTestDatabase());

  it('is absent from the financial backup, image and text alike', async () => {
    makeAccount('Cash', 'NPR', 500_000);
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    const backup = JSON.stringify(createBackup());

    // No table, no image path, and nothing that was printed on the paper.
    expect(backup).not.toContain('receipt');
    expect(backup).not.toContain('secret-receipt');
    expect(backup).not.toContain('PRIVATE CLINIC');
    expect(backup).not.toContain('9812345678');
    expect(backup).not.toContain('4321');
  });

  it('has no place in the cloud sync vocabulary at all', () => {
    // Adding a receipt entity type is the change this test exists to catch.
    expect(SYNC_ENTITY_TYPES).not.toContain('receipt_draft');
    expect(SYNC_ENTITY_TYPES.some((type) => type.includes('receipt'))).toBe(false);
  });

  it('queues no sync work, and leaves the local audit clean', async () => {
    const created = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(created.id);

    expect(countPendingSyncMutations()).toBe(0);
    // Receipt drafts carry no sync identity by design, and the audit must not
    // start demanding one.
    expect(verifySyncIntegrity().issues).toEqual([]);
    expect(() => assertSyncFoundationReady()).not.toThrow();
  });
});

describe('a receipt moves no money', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.clear();
    files.add(IMAGE);
    fakeOcr();
  });
  afterEach(() => resetReceiptOcrProvider());

  it('leaves the dashboard, reports and budgets exactly where they were', async () => {
    const cash = makeAccount('Cash', 'NPR', 500_000);
    const food = expenseCategory();
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: food.id,
      amountMinor: 25_000,
      title: 'Lunch',
      transactionDate: new Date(2026, 8, 5, 12),
    });
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: 1_500_000,
    });

    const range = getReportRange('this_month', new Date(2026, 8, 12));
    const before = {
      dashboard: getDashboardSummary(),
      report: getReportSummary(range),
      budget: budgetService.getMonthlyBudgetSummary('2026-09'),
    };

    const created = processing.registerCapturedReceipt(IMAGE);
    const outcome = await processing.processReceiptDraft(created.id);
    // The receipt was read successfully, and says 4,500 was spent at a clinic.
    expect(outcome.status).toBe('ready_for_review');

    // And not one figure in the application moved, because a draft is a plan
    // to ask a person, not a record of anything.
    expect(getDashboardSummary()).toEqual(before.dashboard);
    expect(getReportSummary(range)).toEqual(before.report);
    expect(budgetService.getMonthlyBudgetSummary('2026-09')).toEqual(before.budget);
  });
});

describe('the receipt pipeline and the transaction service', () => {
  const receiptsDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/features/receipts',
  );
  const receiptScreensDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/app/receipt',
  );
  const relative = (file: string) =>
    file
      .slice(receiptsDirectory.length + 1)
      .split(sep)
      .join('/');

  /**
   * A source-level check, deliberately.
   *
   * The behavioural tests prove no transaction exists after a scan, but they
   * can only prove it for the paths they exercise. This proves the capability
   * is absent from the feature altogether: M9A cannot create an expense
   * because it never references anything that could.
   */
  it('creates money from exactly one file, and only an expense', () => {
    const creators: string[] = [];
    const offenders: string[] = [];
    for (const file of walk(receiptsDirectory)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('createExpense') || source.includes('transaction.service')) {
        creators.push(relative(file));
      }
      // Never another kind of money, and never the outbox by hand.
      for (const forbidden of ['createIncome', 'createTransfer', 'enqueueSyncMutation']) {
        if (source.includes(forbidden)) offenders.push(`${relative(file)}: ${forbidden}`);
      }
    }
    // M9B's Save Expense is the single, deliberate exception. Capture, OCR,
    // extraction and processing still cannot reach a transaction at all.
    expect(creators).toEqual(['review/receipt-save.service.ts']);
    expect(offenders).toEqual([]);
  });

  it('keeps the receipt screens off the database and the transaction service', () => {
    const offenders: string[] = [];
    for (const file of walk(receiptScreensDirectory)) {
      const source = readFileSync(file, 'utf8');
      // Screens go through the UI data boundary, and Save Expense through the
      // one save service — never a repository, never SQL, never createExpense.
      // Shared constants are not the database; the database itself is.
      for (const forbidden of [
        "from '@/db'",
        "'@/db/schema",
        'drizzle',
        'createExpense',
        'transaction.service',
        'repository',
      ]) {
        if (source.includes(forbidden)) offenders.push(`${file}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sends nothing to a remote service', () => {
    const offenders: string[] = [];
    for (const file of walk(receiptsDirectory)) {
      const source = readFileSync(file, 'utf8');
      // No cloud OCR, no LLM, no upload — and no key to do it with.
      for (const forbidden of ['fetch(', 'supabase', 'openai', 'api_key', 'apiKey', 'Bearer ']) {
        if (source.includes(forbidden)) offenders.push(`${file}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('logs nothing at all from the receipt pipeline or its screens', () => {
    const offenders: string[] = [];
    for (const file of [...walk(receiptsDirectory), ...walk(receiptScreensDirectory)]) {
      const source = readFileSync(file, 'utf8');
      if (/console\.(log|warn|error|info|debug)/.test(source)) offenders.push(file);
    }
    // Raw OCR text, merchant names, card fragments and review values all pass
    // through these files. The simplest way to never log one is to never log.
    expect(offenders).toEqual([]);
  });
});

function* walk(directory: string): Generator<string> {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) yield path;
  }
}
