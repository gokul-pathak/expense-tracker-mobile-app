import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

/**
 * The staged photo, as an in-memory set with a switch that makes deleting fail.
 *
 * What matters here is not the file system but what the save does when
 * housekeeping goes wrong: the expense must stand either way.
 */
const files = vi.hoisted(() => ({ present: new Set<string>(), failDelete: false }));
vi.mock('@/features/receipts/capture/receipt-files', () => ({
  stageReceiptFile: async (uri: string) => uri,
  receiptFileExists: async (uri: string) => files.present.has(uri),
  receiptFileSize: async () => undefined,
  deleteReceiptFile: async (uri: string) => {
    if (files.failDelete) throw new Error('storage unavailable');
    files.present.delete(uri);
  },
  deleteStaleReceiptFiles: async () => 0,
  clearReceiptWorkingDirectory: async () => {
    files.present.clear();
  },
}));

import { createBackup } from '@/features/backup/backup.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import {
  resetReceiptOcrProvider,
  setReceiptOcrProvider,
} from '@/features/receipts/ocr/receipt-ocr';
import { getReceiptDraft } from '@/features/receipts/receipt-draft.repository';
import * as processing from '@/features/receipts/receipt-processing.service';
import {
  buildReceiptReview,
  describeReviewSaveError,
  editReview,
  toExpenseInput,
  type ReceiptReview,
} from '@/features/receipts/review/receipt-review.model';
import { saveReceiptExpense } from '@/features/receipts/review/receipt-save.service';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { ValidationError } from '@/features/shared/errors';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory } from '../recurring/fixture';
import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient, reopenTestDatabase } from '../support/test-database';

/**
 * Save Expense, end to end, against real SQLite.
 *
 * The milestone's own fixture — ABC STORE, NPR 1,017, 12 September, filed
 * under Food from Cash — goes through the real pipeline: a captured photo, a
 * read, a review built by the same model the screen renders, and the one save
 * boundary. Every figure the app shows is checked before and after.
 */

const IMAGE = 'file:///private/receipt-processing/abc.jpg';

const RECEIPT = `ABC STORE
12 SEP 2026
TOTAL NPR 1,017.00`;

const REVIEWED_ON = new Date(2026, 8, 13, 10);

async function scanned(text = RECEIPT, image = IMAGE): Promise<number> {
  files.present.add(image);
  setReceiptOcrProvider({
    id: 'fake-ocr',
    getCapability: async () => ({ status: 'available' }),
    recognize: async () => ({ text, lines: text.split('\n'), provider: 'fake-ocr' }),
  });
  const draft = processing.registerCapturedReceipt(image);
  const outcome = await processing.processReceiptDraft(draft.id);
  expect(outcome.status).toBe('ready_for_review');
  return draft.id;
}

/** What the person does on Review Receipt: choose a category and an account. */
function reviewed(draftId: number, categoryId: number, accountId: number): ReceiptReview {
  const draft = getReceiptDraft(draftId);
  if (draft === null) throw new Error('draft missing');
  let review = buildReceiptReview(draft, REVIEWED_ON);
  review = editReview(review, 'categoryId', categoryId);
  review = editReview(review, 'accountId', accountId);
  return review;
}

function inputOf(review: ReceiptReview) {
  const input = toExpenseInput(review.values);
  if (input === null) throw new Error('review is not saveable');
  return input;
}

function countRows(table: string): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table}`).get() as {
    total: number;
  };
  return row.total;
}

function outboxEntityTypes(): string[] {
  return (
    rawClient().prepare('SELECT entity_type AS type FROM sync_outbox').all() as { type: string }[]
  ).map((row) => row.type);
}

function september() {
  return getReportSummary(getReportRange('this_month', new Date(2026, 8, 13)));
}

function august() {
  return getReportSummary(getReportRange('this_month', new Date(2026, 7, 13)));
}

function foodSpent(month: string, foodId: number): number | undefined {
  return budgetService
    .getMonthlyBudgetSummary(month)
    .categoryBudgets.find((progress) => progress.budget.categoryId === foodId)?.spentMinor;
}

function snapshot(accountId: number) {
  return {
    balance: getAccountBalance(accountId),
    dashboard: getDashboardSummary(),
    september: september(),
    august: august(),
    budget: budgetService.getMonthlyBudgetSummary('2026-09'),
    pending: countPendingSyncMutations(),
    transactions: countRows('transactions'),
  };
}

describe('Save Expense from a scanned receipt', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.present.clear();
    files.failDelete = false;
  });
  afterEach(() => resetReceiptOcrProvider());
  afterAll(() => closeTestDatabase());

  it('changes nothing at all until Save Expense is pressed', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: 1_500_000,
    });
    const before = snapshot(cash.id);

    const draftId = await scanned();
    reviewed(draftId, food.id, cash.id);

    // Captured, read and reviewed — and not one figure moved.
    expect(snapshot(cash.id)).toEqual(before);
    expect(outboxEntityTypes().some((type) => type.includes('receipt'))).toBe(false);
  });

  it('creates exactly the reviewed expense, and the balance falls to 8,983.00', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000); // 10,000.00
    const food = expenseCategory('Food');
    const draftId = await scanned();

    const result = await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));

    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    const expense = transactionService.getTransaction(result.transactionId);
    expect(expense).toMatchObject({
      type: 'expense',
      amountMinor: 101_700,
      currency: 'NPR',
      categoryId: food.id,
      sourceAccountId: cash.id,
      note: 'ABC STORE',
      recurringOccurrenceId: null,
    });
    expect(localDateOf(expense.transactionDate)).toBe('2026-09-12');
    expect(getAccountBalance(cash.id)).toBe(898_300);
  });

  it('moves the budget, the report, Home and the outbox once, like a typed expense', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: 1_500_000,
    });
    const draftId = await scanned();
    const before = snapshot(cash.id);

    await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));

    expect(foodSpent('2026-09', food.id)).toBe(101_700);
    expect(september().expenseMinor).toBe(before.september.expenseMinor + 101_700);
    expect(getDashboardSummary().totalBalanceMinor).toBe(
      before.dashboard.totalBalanceMinor - 101_700,
    );
    // The expense itself queues for upload, exactly once. The receipt does not.
    expect(countPendingSyncMutations()).toBe(before.pending + 1);
    expect(outboxEntityTypes().some((type) => type.includes('receipt'))).toBe(false);
  });

  it('saves what the person entered, in the month they chose', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-08',
      amountMinor: 1_500_000,
    });
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: 1_500_000,
    });
    const draftId = await scanned();
    const septemberBefore = september();
    const augustBefore = august();

    let review = reviewed(draftId, food.id, cash.id);
    review = editReview(review, 'amountInput', '1200');
    review = editReview(review, 'transactionDate', '2026-08-31');
    const result = await saveReceiptExpense(draftId, inputOf(review));
    if (result.status !== 'saved') throw new Error('expected saved');

    const expense = transactionService.getTransaction(result.transactionId);
    // The receipt said 1,017 on the 12th. The person said 1,200 on the 31st.
    expect(expense.amountMinor).toBe(120_000);
    expect(localDateOf(expense.transactionDate)).toBe('2026-08-31');

    // A backdated receipt moves the balance now, and August's figures only.
    expect(getAccountBalance(cash.id)).toBe(1_000_000 - 120_000);
    expect(august().expenseMinor).toBe(augustBefore.expenseMinor + 120_000);
    expect(september()).toEqual(septemberBefore);
    expect(foodSpent('2026-08', food.id)).toBe(120_000);
    expect(foodSpent('2026-09', food.id)).toBe(0);
  });

  it('creates one expense however many times Save Expense is pressed', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    const input = inputOf(reviewed(draftId, food.id, cash.id));
    const before = countRows('transactions');

    // Three rapid taps.
    const results = await Promise.all([
      saveReceiptExpense(draftId, input),
      saveReceiptExpense(draftId, input),
      saveReceiptExpense(draftId, input),
    ]);
    // And a retry after a navigation that went wrong.
    const retry = await saveReceiptExpense(draftId, input);

    expect(countRows('transactions')).toBe(before + 1);
    expect(results.map((result) => result.status)).toEqual([
      'saved',
      'already_saved',
      'already_saved',
    ]);
    const ids = new Set(
      [...results, retry].map((result) => ('transactionId' in result ? result.transactionId : 0)),
    );
    expect(ids.size).toBe(1);
    expect(retry.status).toBe('already_saved');
    expect(getAccountBalance(cash.id)).toBe(898_300);
  });

  it('leaves the draft ready to try again when the save is refused', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const bank = makeAccount('Bank', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    const review = reviewed(draftId, food.id, cash.id);
    const before = countRows('transactions');

    // Another device archived Cash while this receipt was open.
    rawClient().prepare('UPDATE accounts SET is_archived = 1 WHERE id = ?').run(cash.id);

    let refusal: unknown;
    try {
      await saveReceiptExpense(draftId, inputOf(review));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ValidationError);
    expect(describeReviewSaveError(refusal).clear).toBe('accountId');

    // Nothing was created, and nothing about the draft was spent.
    expect(countRows('transactions')).toBe(before);
    const draft = getReceiptDraft(draftId);
    expect(draft?.finalizedTransactionId).toBeNull();
    expect(draft?.status).toBe('ready_for_review');
    expect(draft?.amountMinor).toBe(101_700);
    expect(files.present.has(IMAGE)).toBe(true);

    // Choosing another account and pressing Save Expense again works.
    const retry = await saveReceiptExpense(
      draftId,
      inputOf(editReview(review, 'accountId', bank.id)),
    );
    expect(retry.status).toBe('saved');
    expect(countRows('transactions')).toBe(before + 1);
  });

  it('keeps no expense whose receipt could not be marked saved, so a retry saves once', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    const input = inputOf(reviewed(draftId, food.id, cash.id));
    const before = snapshot(cash.id);

    // The second write of the save fails: a full disk, an I/O error, or the
    // process dying between two commits. An expense that outlived its marker
    // would reopen as an unsaved review, and saving it again would be a duplicate.
    rawClient().exec(`CREATE TRIGGER refuse_finalize
      BEFORE UPDATE OF finalized_transaction_id ON receipt_drafts
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;`);

    await expect(saveReceiptExpense(draftId, input)).rejects.toThrow();

    // Both writes, or neither.
    expect(snapshot(cash.id)).toEqual(before);
    const draft = getReceiptDraft(draftId);
    expect(draft?.finalizedTransactionId).toBeNull();
    expect(draft?.status).toBe('ready_for_review');
    expect(files.present.has(IMAGE)).toBe(true);

    rawClient().exec('DROP TRIGGER refuse_finalize');
    const retry = await saveReceiptExpense(draftId, input);

    expect(retry.status).toBe('saved');
    expect(countRows('transactions')).toBe(before.transactions + 1);
    expect(countPendingSyncMutations()).toBe(before.pending + 1);
    expect(getAccountBalance(cash.id)).toBe(898_300);
  });

  it('refuses a draft that never finished reading, or no longer exists', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    files.present.add(IMAGE);
    setReceiptOcrProvider({
      id: 'fake-ocr',
      getCapability: async () => ({ status: 'available' }),
      recognize: async () => ({ text: '  ', lines: [], provider: 'fake-ocr' }),
    });
    const unread = processing.registerCapturedReceipt(IMAGE);
    await processing.processReceiptDraft(unread.id);
    const input = {
      amountMinor: 101_700,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: new Date(2026, 8, 12),
    };

    expect(await saveReceiptExpense(unread.id, input)).toEqual({ status: 'draft_unavailable' });
    expect(await saveReceiptExpense(9_999, input)).toEqual({ status: 'draft_unavailable' });
    expect(countRows('transactions')).toBe(0);
  });
});

describe('after Save Expense', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.present.clear();
    files.failDelete = false;
  });
  afterEach(() => resetReceiptOcrProvider());

  it('removes the photo and keeps only the marker that stops a second save', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();

    const result = await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));
    if (result.status !== 'saved') throw new Error('expected saved');

    expect(files.present.has(IMAGE)).toBe(false);
    const draft = getReceiptDraft(draftId);
    expect(draft?.finalizedTransactionId).toBe(result.transactionId);
    // The expense is the record now; the merchant and amount do not linger here.
    expect(draft?.merchantName).toBeNull();
    expect(draft?.amountMinor).toBeNull();
  });

  it('never reopens a saved receipt as an unsaved one after a restart', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    const result = await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));
    if (result.status !== 'saved') throw new Error('expected saved');

    reopenTestDatabase();

    expect(getReceiptDraft(draftId)?.finalizedTransactionId).toBe(result.transactionId);
    const again = await saveReceiptExpense(draftId, {
      amountMinor: 101_700,
      categoryId: food.id,
      accountId: cash.id,
      transactionDate: new Date(2026, 8, 12),
    });
    expect(again).toEqual({ status: 'already_saved', transactionId: result.transactionId });
    expect(countRows('transactions')).toBe(1);
  });

  it('keeps an unsaved review across a restart', async () => {
    const draftId = await scanned();

    reopenTestDatabase();

    const draft = getReceiptDraft(draftId);
    expect(draft?.status).toBe('ready_for_review');
    expect(buildReceiptReview(draft!, REVIEWED_ON).values.amountInput).toBe('1017.00');
  });

  it('keeps the expense when the photo cannot be deleted, and sweeps it later', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    files.failDelete = true;

    const result = await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));

    // Housekeeping failed. The money did not.
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(files.present.has(IMAGE)).toBe(true);
    expect(getAccountBalance(cash.id)).toBe(898_300);

    files.failDelete = false;
    const swept = await processing.cleanupExpiredReceiptDrafts(new Date(2027, 0, 1));

    expect(swept).toBe(1);
    expect(files.present.has(IMAGE)).toBe(false);
    expect(getReceiptDraft(draftId)).toBeNull();
    // Sweeping receipt drafts can never reach the expense they became.
    expect(transactionService.getTransaction(result.transactionId).amountMinor).toBe(101_700);
    expect(getAccountBalance(cash.id)).toBe(898_300);
  });

  it('keeps the saved expense in the backup and the receipt out of it', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));

    const backup = JSON.stringify(createBackup());

    expect(backup).toContain('101700');
    expect(backup).not.toContain('receipt');
  });

  it('leaves recurring state alone', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const food = expenseCategory('Food');
    const draftId = await scanned();
    await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));

    expect(countRows('recurring_templates')).toBe(0);
    expect(countRows('recurring_occurrences')).toBe(0);
  });
});

describe('discarding a receipt', () => {
  beforeEach(async () => {
    await setupDatabase();
    files.present.clear();
    files.failDelete = false;
  });
  afterEach(() => resetReceiptOcrProvider());

  it('creates no expense and removes the draft and its photo', async () => {
    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const draftId = await scanned();
    const before = snapshot(cash.id);

    await processing.discardReceiptDraft(draftId);

    expect(getReceiptDraft(draftId)).toBeNull();
    expect(files.present.has(IMAGE)).toBe(false);
    expect(snapshot(cash.id)).toEqual(before);
  });

  it('keeps a draft waiting while the first account is created', async () => {
    const food = expenseCategory('Food');
    const draftId = await scanned();

    // No account exists yet; the draft simply waits.
    expect(getReceiptDraft(draftId)?.status).toBe('ready_for_review');

    const cash = makeAccount('Cash', 'NPR', 1_000_000);
    const result = await saveReceiptExpense(draftId, inputOf(reviewed(draftId, food.id, cash.id)));
    expect(result.status).toBe('saved');
  });
});
