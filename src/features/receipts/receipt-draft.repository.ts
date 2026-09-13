import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { db } from '@/db';
import { receiptDrafts, type ReceiptDraftRow } from '@/db/schema/receipts';

import type { ReceiptExpenseDraft, ReceiptFailureReason } from './receipt.types';

/**
 * Reading and writing receipt drafts.
 *
 * Small and explicit on purpose: a handful of named operations rather than a
 * general query surface. Drafts are the one table in this app that holds
 * fragments of a photograph of someone's life, and a narrow door is easier to
 * keep watch on than a wide one.
 *
 * Nothing here touches `transactions`, and nothing here enqueues sync work.
 * Creating, updating and discarding a draft leaves the outbox exactly as it
 * was — a receipt is not a financial change until M9B makes one.
 */

/** What a draft looks like once its stored JSON has been read back. */
export type StoredReceiptDraft = Omit<ReceiptDraftRow, 'confidence'> & {
  confidence: ReceiptDraftConfidence | null;
};

/** Per-field confidence, kept small enough to be worth storing. */
export type ReceiptDraftConfidence = {
  amount?: { confidence: string; basis: string };
  currency?: { confidence: string; basis: string; source: string };
  date?: { confidence: string; basis: string };
  merchant?: { confidence: string; basis: string };
};

export function createReceiptDraft(imageUri: string, expiresAt: Date | null): StoredReceiptDraft {
  const now = new Date();
  const row = db
    .insert(receiptDrafts)
    .values({
      imageUri,
      status: 'captured',
      processingGeneration: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    })
    .returning()
    .get();
  return hydrate(row);
}

export function getReceiptDraft(id: number): StoredReceiptDraft | null {
  const row = db.select().from(receiptDrafts).where(eq(receiptDrafts.id, id)).get();
  return row === undefined ? null : hydrate(row);
}

/** Every draft still worth showing, oldest first. */
export function listReceiptDrafts(): StoredReceiptDraft[] {
  return db.select().from(receiptDrafts).orderBy(asc(receiptDrafts.id)).all().map(hydrate);
}

/**
 * Claims the draft for a new processing run and returns the generation token
 * that run must present when it finishes.
 *
 * Every restart bumps the counter, so a run started against an older image can
 * be recognised as stale no matter how long it takes to come back.
 */
export function beginProcessing(id: number): number | null {
  const row = db
    .update(receiptDrafts)
    .set({
      status: 'processing',
      failureReason: null,
      processingGeneration: sql`${receiptDrafts.processingGeneration} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(receiptDrafts.id, id))
    .returning()
    .get();
  return row === undefined ? null : row.processingGeneration;
}

/**
 * Records what the parser found — but only if this run is still the current
 * one. A late result from a replaced image is dropped rather than written.
 */
export function applyExtraction(
  id: number,
  generation: number,
  draft: ReceiptExpenseDraft,
  ocrProvider: string,
): boolean {
  const confidence: ReceiptDraftConfidence = {
    amount: { confidence: draft.amountMinor.confidence, basis: draft.amountMinor.basis },
    currency: {
      confidence: draft.currency.confidence,
      basis: draft.currency.basis,
      source: draft.currency.source,
    },
    date: { confidence: draft.transactionDate.confidence, basis: draft.transactionDate.basis },
    merchant: { confidence: draft.merchantName.confidence, basis: draft.merchantName.basis },
  };

  const updated = db
    .update(receiptDrafts)
    .set({
      status: 'ready_for_review',
      failureReason: null,
      merchantName: draft.merchantName.value,
      amountMinor: draft.amountMinor.value,
      currency: draft.currency.value,
      transactionDate: draft.transactionDate.value,
      confidence: JSON.stringify(confidence),
      parserVersion: draft.parserVersion,
      ocrProvider,
      updatedAt: new Date(),
    })
    .where(current(id, generation))
    .returning()
    .get();
  return updated !== undefined;
}

/** Records a failure, again only for the current run. Clears any stale candidates. */
export function markFailed(id: number, generation: number, reason: ReceiptFailureReason): boolean {
  const updated = db
    .update(receiptDrafts)
    .set({
      status: 'failed',
      failureReason: reason,
      // A failed read must not leave yesterday's figures lying around looking
      // like this receipt's.
      merchantName: null,
      amountMinor: null,
      currency: null,
      transactionDate: null,
      confidence: null,
      updatedAt: new Date(),
    })
    .where(current(id, generation))
    .returning()
    .get();
  return updated !== undefined;
}

/**
 * Removes the draft row outright.
 *
 * No tombstone: nothing else in the world needs to be told that a photograph
 * stopped being processed. Deleting the image file is the caller's job, and
 * happens whether or not this row was there.
 */
export function discardReceiptDraft(id: number): StoredReceiptDraft | null {
  const row = db.delete(receiptDrafts).where(eq(receiptDrafts.id, id)).returning().get();
  return row === undefined ? null : hydrate(row);
}

/**
 * Drafts whose time is up.
 *
 * A draft being processed or waiting to be reviewed is excluded by its
 * `expiresAt` being pushed out, not by a special case here — expiry is a date,
 * so a sweep can never take a draft out from under someone mid-review.
 */
export function listExpiredDrafts(now: Date): StoredReceiptDraft[] {
  return db
    .select()
    .from(receiptDrafts)
    .where(and(lte(receiptDrafts.expiresAt, now)))
    .orderBy(asc(receiptDrafts.id))
    .all()
    .map(hydrate);
}

/** Pushes a draft's expiry out, for one that is actively being worked on. */
export function touchReceiptDraft(id: number, expiresAt: Date | null): void {
  db.update(receiptDrafts)
    .set({ expiresAt, updatedAt: new Date() })
    .where(eq(receiptDrafts.id, id))
    .run();
}

function current(id: number, generation: number) {
  return and(eq(receiptDrafts.id, id), eq(receiptDrafts.processingGeneration, generation));
}

function hydrate(row: ReceiptDraftRow): StoredReceiptDraft {
  return { ...row, confidence: parseConfidence(row.confidence) };
}

function parseConfidence(value: string | null): ReceiptDraftConfidence | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as ReceiptDraftConfidence;
  } catch {
    // Stored by an older build in a shape this one does not know. The
    // candidates themselves are columns and survive; only the annotation is
    // lost, and losing it is not worth failing a read over.
    return null;
  }
}
