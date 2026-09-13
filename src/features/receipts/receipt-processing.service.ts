import { DEFAULT_CURRENCY } from '@/db/constants';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import * as settingsRepository from '@/features/settings/settings.repository';

import {
  deleteReceiptFile,
  deleteStaleReceiptFiles,
  receiptFileExists,
} from './capture/receipt-files';
import { extractReceiptDraft } from './extraction/receipt-extraction';
import { getReceiptOcrProvider } from './ocr/receipt-ocr';
import * as repository from './receipt-draft.repository';
import type { StoredReceiptDraft } from './receipt-draft.repository';
import type { ReceiptExpenseDraft, ReceiptFailureReason } from './receipt.types';

/**
 * Image in, draft out, one step at a time.
 *
 * The pipeline is: a staged image, an OCR engine, a pure parser, a stored
 * draft. It ends there. Nothing in this file calls the transaction service,
 * and nothing it writes reaches a balance, a report or a budget — M9B turns a
 * reviewed draft into an expense, with a person's explicit say-so, and that
 * step does not exist yet.
 *
 * Two failure modes shape the design. A cache the OS emptied means the image
 * is simply gone, which is ordinary and must not crash anything. And a slow
 * OCR run that returns after its image was replaced must not overwrite the
 * newer result, which is what the generation token is for.
 */

/** Supported currencies, as offered in Settings. */
const SUPPORTED_CURRENCIES = ['NPR', 'USD', 'INR'] as const;

/**
 * How long a draft survives untouched.
 *
 * Long enough that stepping away mid-review and coming back tomorrow does not
 * lose the capture; short enough that an abandoned photograph of someone's
 * shopping is not still on the device next month.
 */
export const RECEIPT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProcessOutcome =
  | { status: 'ready_for_review'; draft: StoredReceiptDraft; extraction: ReceiptExpenseDraft }
  | { status: 'failed'; reason: ReceiptFailureReason; draft: StoredReceiptDraft | null }
  | { status: 'superseded' };

/** Registers a freshly staged image. No OCR yet; nothing is read until asked. */
export function registerCapturedReceipt(imageUri: string, now = new Date()): StoredReceiptDraft {
  return repository.createReceiptDraft(imageUri, new Date(now.getTime() + RECEIPT_DRAFT_TTL_MS));
}

/**
 * Runs OCR and extraction for one draft.
 *
 * Safe to call again for the same draft — that is the retry path, and it
 * reuses the staged image rather than asking for the receipt to be
 * photographed a second time.
 */
export async function processReceiptDraft(id: number): Promise<ProcessOutcome> {
  const existing = repository.getReceiptDraft(id);
  if (existing === null) return { status: 'failed', reason: 'image_unavailable', draft: null };

  // Claim the draft first, so every exit below has a real generation token to
  // write against. Guessing the next one would silently miss, and the failure
  // would look like another run had taken over.
  const generation = repository.beginProcessing(id);
  if (generation === null) return { status: 'failed', reason: 'image_unavailable', draft: null };

  // Asked before every run, because the answer changes without warning: the
  // system empties its caches when storage runs short and tells nobody.
  if (!(await receiptFileExists(existing.imageUri))) {
    return fail(id, generation, 'image_unavailable');
  }

  const provider = getReceiptOcrProvider();
  const capability = await provider.getCapability();
  if (capability.status !== 'available') {
    return fail(
      id,
      generation,
      capability.status === 'permission_denied' ? 'ocr_failed' : 'ocr_provider_unavailable',
    );
  }

  let text: string;
  try {
    const result = await provider.recognize({
      uri: existing.imageUri,
      mimeType: 'image/jpeg',
      width: 0,
      height: 0,
    });
    text = result.text;
  } catch {
    // The error itself is not carried forward. A provider failure can quote
    // the file path or a fragment of what it read, and neither belongs in a
    // stored record or a log line.
    return fail(id, generation, 'ocr_failed');
  }

  if (text.trim().length === 0) {
    // An unreadable photograph produces a failure, never a draft of zero.
    return fail(id, generation, 'no_text_detected');
  }

  const extraction = extractReceiptDraft(text, {
    defaultCurrency: defaultCurrency(),
    currentLocalDate: localDateOf(new Date()),
    supportedCurrencies: SUPPORTED_CURRENCIES,
  });

  const applied = repository.applyExtraction(id, generation, extraction, provider.id);
  // Another run claimed this draft while OCR was working. That run's result is
  // the current one and this one is discarded — the newer image wins.
  if (!applied) return { status: 'superseded' };

  const draft = repository.getReceiptDraft(id);
  if (draft === null) return { status: 'superseded' };
  return { status: 'ready_for_review', draft, extraction };
}

/**
 * Throws the draft and its image away.
 *
 * Deliberately reaches no further. There is no transaction to unwind, because
 * scanning a receipt never created one.
 */
export async function discardReceiptDraft(id: number): Promise<void> {
  const removed = repository.discardReceiptDraft(id);
  if (removed !== null) await deleteReceiptFile(removed.imageUri);
}

/**
 * Removes drafts whose expiry has passed, and their images — then any image in
 * the working directory that no draft points at any more.
 *
 * Expiry is a stored date rather than a timer, so a draft someone is part-way
 * through reviewing is never swept out from under them: touching it pushes the
 * date out. Financial records are not reachable from here at all.
 *
 * The second pass is what keeps a photo temporary when housekeeping itself
 * fails. An image whose delete failed after its draft row went, or one staged a
 * moment before the app was killed and never registered, belongs to no draft,
 * and nothing else would ever find it. It goes once it is as old as a draft's
 * whole life, so a capture still being registered is never touched.
 */
export async function cleanupExpiredReceiptDrafts(now = new Date()): Promise<number> {
  const expired = repository.listExpiredDrafts(now);
  for (const draft of expired) {
    repository.discardReceiptDraft(draft.id);
    await deleteReceiptFile(draft.imageUri);
  }
  const referenced = new Set(repository.listReceiptDrafts().map((draft) => draft.imageUri));
  await deleteStaleReceiptFiles(RECEIPT_DRAFT_TTL_MS, referenced, now.getTime()).catch(() => 0);
  return expired.length;
}

/** Keeps a draft alive while it is being looked at. */
export function keepReceiptDraftAlive(id: number, now = new Date()): void {
  repository.touchReceiptDraft(id, new Date(now.getTime() + RECEIPT_DRAFT_TTL_MS));
}

function fail(id: number, generation: number, reason: ReceiptFailureReason): ProcessOutcome {
  const applied = repository.markFailed(id, generation, reason);
  if (!applied) return { status: 'superseded' };
  return { status: 'failed', reason, draft: repository.getReceiptDraft(id) };
}

function defaultCurrency(): string {
  try {
    return settingsRepository.getSettings()?.defaultCurrency ?? DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}
