import { createExpense } from '@/features/transactions/transaction.service';
import type { CreateExpenseInput } from '@/features/transactions/transaction.types';

import { deleteReceiptFile } from '../capture/receipt-files';
import * as repository from '../receipt-draft.repository';

/**
 * Save Expense. The only place in the receipt feature that creates money.
 *
 * Everything else under `features/receipts` is forbidden — by test — from
 * referencing the transaction service at all. This file is the single,
 * deliberate exception, and it does one thing: after a person has reviewed a
 * receipt and pressed Save Expense, it asks the ordinary transaction service
 * for an ordinary expense. Every rule a typed expense meets applies — an active
 * account, an expense category, a positive safe-integer amount, the account's
 * currency — because there is no second path for the rules to be missing from.
 *
 * Saving twice is refused by the draft, not only by a disabled button. The
 * check, the expense and the finalization run back to back with no `await`
 * between them, so on a single JavaScript thread a second tap, a stale screen
 * or a back-navigation retry always finds the draft already finalized and is
 * told which expense it became.
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
 * Creates the reviewed expense and retires the draft.
 *
 * Throws whatever the transaction service throws, with the draft untouched,
 * so a refused save can be corrected and tried again. Removing the photo
 * afterwards is housekeeping: if it fails the expense stands regardless, and
 * the stale-draft sweep removes the file later.
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

  const transaction = createExpense(input);
  repository.markReceiptDraftFinalized(
    draftId,
    transaction.id,
    new Date(now.getTime() + FINALIZED_DRAFT_RETENTION_MS),
  );

  // Everything financial is done. Nothing below can undo it.
  try {
    await deleteReceiptFile(draft.imageUri);
  } catch {
    // The expense is the record. A photo left behind is swept later.
  }
  return { status: 'saved', transactionId: transaction.id };
}
