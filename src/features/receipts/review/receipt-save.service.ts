import { db } from '@/db';
import { ConflictError } from '@/features/shared/errors';
import { insertTransaction } from '@/features/transactions/transaction.repository';
import { prepareExpense } from '@/features/transactions/transaction.service';
import type { CreateExpenseInput } from '@/features/transactions/transaction.types';

import { deleteReceiptFile } from '../capture/receipt-files';
import * as repository from '../receipt-draft.repository';

/**
 * Save Expense. The only place in the receipt feature that creates money.
 *
 * Everything else under `features/receipts` is forbidden — by test — from
 * referencing the transaction service or repository at all. This file is the
 * single, deliberate exception, and it does one thing: after a person has
 * reviewed a receipt and pressed Save Expense, it writes an ordinary expense.
 * The expense is built by the same function `createExpense` uses, so every rule
 * a typed expense meets applies — an active account, an expense category, a
 * positive safe-integer amount, the account's currency — because there is no
 * second path for the rules to be missing from.
 *
 * Saving twice is refused by the draft, not only by a disabled button, and the
 * refusal survives a crash. The expense, its outbox entry and the draft's
 * finalization are one SQLite transaction. There is no committed state in which
 * the expense exists while the draft still reads as unsaved — which is the state
 * that would reopen as a review after a restart, a full disk or an I/O error,
 * and turn the next Save Expense into a duplicate. So a second tap, a stale
 * screen, a back-navigation retry or a restart always finds the draft finalized
 * and is told which expense it became.
 */

/**
 * How long a saved draft's finalization marker is kept.
 *
 * Long enough to catch a stale screen re-submitting after a navigation hiccup
 * or a restart; after it, the row is swept and a re-submit finds no draft,
 * which refuses just as surely.
 */
export const FINALIZED_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type ReceiptSaveResult =
  | { status: 'saved'; transactionId: number }
  /** Already saved as this expense. Nothing new was created. */
  | { status: 'already_saved'; transactionId: number }
  /** Discarded, expired, or never finished reading. Nothing was created. */
  | { status: 'draft_unavailable' };

/**
 * Creates the reviewed expense and retires the draft, atomically.
 *
 * Throws whatever the transaction rules or SQLite throw, with the draft
 * untouched and no expense written, so a refused or failed save can be
 * corrected and tried again. Removing the photo afterwards is housekeeping: if
 * it fails the expense stands regardless, and the stale-draft sweep removes the
 * file later.
 */
export async function saveReceiptExpense(
  draftId: number,
  input: CreateExpenseInput,
  now: Date = new Date(),
): Promise<ReceiptSaveResult> {
  const draft = repository.getReceiptDraft(draftId);
  if (draft === null) return { status: 'draft_unavailable' };
  if (draft.finalizedTransactionId !== null) {
    return { status: 'already_saved', transactionId: draft.finalizedTransactionId };
  }
  if (draft.status !== 'ready_for_review') return { status: 'draft_unavailable' };

  // Refused here, before anything is written, exactly as Add Expense refuses it.
  const record = prepareExpense(input);
  const expiresAt = new Date(now.getTime() + FINALIZED_DRAFT_RETENTION_MS);

  const transaction = db.transaction((tx) => {
    const created = insertTransaction(tx, record);
    // The check that commits. Nothing can change the draft between the read
    // above and here on one thread — but if it ever did, keeping this expense
    // is exactly the duplicate this function exists to prevent.
    if (!repository.markReceiptDraftFinalized(draftId, created.id, expiresAt, tx)) {
      throw new ConflictError('This receipt changed while it was being saved. Nothing was saved.');
    }
    return created;
  });

  // Everything financial is committed. Nothing below can undo it.
  try {
    await deleteReceiptFile(draft.imageUri);
  } catch {
    // The expense is the record. A photo left behind is swept later.
  }
  return { status: 'saved', transactionId: transaction.id };
}
