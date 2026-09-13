import { sql } from 'drizzle-orm';
import { check, index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
  RECEIPT_PROCESSING_STATUSES,
  type ReceiptProcessingStatusName,
  type PaymentMode,
} from '../constants';

const statusList = RECEIPT_PROCESSING_STATUSES.map((value) => `'${value}'`).join(', ');

/**
 * A receipt part-way through being read. Local to this device, always.
 *
 * Three things are deliberately absent, and their absence is the design:
 *
 * - **No `sync_id`.** Every other table in this app carries one because every
 *   other table is a record of money that has to converge across devices. A
 *   half-read photograph is not that. It is scratch work, and uploading it
 *   would put a picture of someone's shopping — and everything else printed on
 *   the paper — into a financial database that was never scoped to hold it.
 * - **No `deleted_at`.** Nothing needs to learn that a draft was discarded, so
 *   discarding one removes the row outright rather than leaving a tombstone.
 * - **No raw OCR text.** The extracted candidates are kept; the full text the
 *   engine produced is not. Receipts print phone numbers, addresses, loyalty
 *   IDs and card fragments, and the cheapest way to never leak them is to
 *   never store them.
 *
 * The image itself is not here either — only a URI into the app's private
 * cache, which the OS may empty at any time. A draft whose image has gone is
 * expired, not corrupt.
 */
export const receiptDrafts = sqliteTable(
  'receipt_drafts',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    /** Points into the private working directory. Never a shared or public path. */
    imageUri: text('image_uri').notNull(),
    status: text('status').notNull().$type<ReceiptProcessingStatusName>(),
    /** Set only when `status` is `failed`; a classification, never a message from a provider. */
    failureReason: text('failure_reason'),

    // Candidates. All nullable: a draft that found only an amount is a useful
    // draft, and one that found nothing must not masquerade as a zero expense.
    merchantName: text('merchant_name'),
    amountMinor: int('amount_minor'),
    currency: text('currency'),
    /** `YYYY-MM-DD`, the same calendar text the rest of the app uses. */
    transactionDate: text('transaction_date'),
    /** A payment-mode suggestion. Never used to choose an account. */
    paymentMode: text('payment_mode').$type<PaymentMode>(),

    /** Per-field confidence and basis, as JSON. No amounts beyond the ones above, no OCR text. */
    confidence: text('confidence'),
    parserVersion: int('parser_version'),
    /** Which engine read it, for diagnostics. Never a credential. */
    ocrProvider: text('ocr_provider'),

    /**
     * Incremented every time processing restarts for this draft.
     *
     * A slow OCR run that finishes after the image has been replaced must not
     * overwrite the newer result. The run carries the generation it started
     * with, and a write whose generation is stale is dropped.
     */
    processingGeneration: int('processing_generation').notNull().default(0),

    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /** When the cleanup sweep may remove this draft and its image. */
    expiresAt: int('expires_at', { mode: 'timestamp_ms' }),

    /**
     * The expense this receipt became, once someone pressed Save Expense.
     *
     * Set once, and it is what stops a second save: a stale review screen, a
     * back-navigation, or a double tap all find it and are told the receipt is
     * already saved. Deliberately not a foreign key. Choosing the cloud's copy
     * during reconciliation hard-deletes local transactions, and a constraint
     * here would make that fail on account of a scratch table.
     */
    finalizedTransactionId: int('finalized_transaction_id'),
    finalizedAt: int('finalized_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('valid_receipt_status', sql`\`status\` IN (${sql.raw(statusList)})`),
    // A draft amount is still money: whole minor units, and never zero or
    // negative, which would be a failure dressed up as a reading.
    check('valid_receipt_amount', sql`\`amount_minor\` IS NULL OR \`amount_minor\` > 0`),
    index('idx_receipt_drafts_status').on(t.status),
    index('idx_receipt_drafts_expires_at').on(t.expiresAt),
  ],
);

export type ReceiptDraftRow = typeof receiptDrafts.$inferSelect;
export type NewReceiptDraftRow = typeof receiptDrafts.$inferInsert;
