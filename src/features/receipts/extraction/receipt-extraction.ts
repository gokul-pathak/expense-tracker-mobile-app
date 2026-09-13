import type { PaymentMode } from '@/db/constants';
import type { LocalDate } from '@/features/recurring/recurring-schedule';

import {
  missing,
  field,
  PARSER_VERSION,
  type ExtractedField,
  type ReceiptExpenseDraft,
  type ReceiptLineLabel,
} from '../receipt.types';

import { classifyLine, extractAmount } from './receipt-amount';
import { extractCurrency } from './receipt-currency';
import { extractDate, lineLooksLikeDate } from './receipt-date';
import { extractMerchant } from './receipt-merchant';
import { normalizeReceiptText, labelHas, type NormalizedReceiptText } from './receipt-text';

/**
 * OCR text in, draft out. Pure, and that is the point.
 *
 * No clock, no database, no settings lookup, no file system. Everything the
 * extractor is allowed to know arrives in `context`, so the same receipt text
 * produces the same draft on every device, in every time zone, in every test
 * run — and so the fixtures in `test/receipts` are a real specification rather
 * than a snapshot of whatever the machine happened to do that day.
 *
 * What comes out is a *draft*. It has no account, no category and no id, it
 * touches nothing, and M9B will show it to a person before any of it becomes
 * an expense.
 */

export type ReceiptExtractionContext = {
  /** Offered as a labelled fallback when the receipt names no currency. */
  defaultCurrency: string | null;
  /** Today, for noticing dates that cannot have happened yet. */
  currentLocalDate: LocalDate;
  supportedCurrencies: readonly string[];
};

/** Payment words that mean exactly one thing. Anything vaguer is left null. */
const PAYMENT_HINTS: readonly (readonly [PaymentMode, readonly string[]])[] = [
  ['credit_card', ['CREDIT CARD', 'CREDITCARD']],
  ['debit_card', ['DEBIT CARD', 'DEBITCARD']],
  ['cheque', ['CHEQUE', 'CHECK NO']],
  ['qr', ['QR', 'QR PAYMENT', 'SCAN TO PAY', 'FONEPAY']],
  ['digital_wallet', ['ESEWA', 'KHALTI', 'IME PAY', 'PAYTM', 'WALLET', 'UPI']],
  ['bank_transfer', ['BANK TRANSFER', 'NEFT', 'IMPS', 'WIRE TRANSFER']],
  ['cash', ['CASH', 'CASH TENDERED']],
];

/** Brands that say a card was used but not which kind. */
const CARD_BRANDS = ['VISA', 'MASTERCARD', 'MASTER CARD', 'MAESTRO', 'AMEX', 'UNIONPAY', 'RUPAY'];

export function extractReceiptDraft(
  ocrText: string,
  context: ReceiptExtractionContext,
): ReceiptExpenseDraft {
  const normalized = normalizeReceiptText(ocrText);
  return extractFromNormalized(normalized, context);
}

export function extractFromNormalized(
  normalized: NormalizedReceiptText,
  context: ReceiptExtractionContext,
): ReceiptExpenseDraft {
  // Classify every line once. Both the amount parser and the merchant filter
  // need to know what a line is about, and classifying twice is how the two
  // would eventually disagree.
  const labels: ReceiptLineLabel[] = normalized.lines.map((line) =>
    classifyLine(line, lineLooksLikeDate(line.text)),
  );

  const amount = extractAmount(normalized, labels);

  return {
    transactionType: 'expense',
    amountMinor: amount.amountMinor,
    currency: extractCurrency(normalized, {
      defaultCurrency: context.defaultCurrency,
      supportedCurrencies: context.supportedCurrencies,
    }),
    transactionDate: extractDate(normalized, { currentLocalDate: context.currentLocalDate }),
    merchantName: extractMerchant(normalized, labels),
    paymentMode: extractPaymentMode(normalized),

    // Not inferable from a receipt, and not guessed. M9B asks; M9C may suggest.
    accountId: null,
    categoryId: null,

    amountCandidates: amount.candidates,
    parserVersion: PARSER_VERSION,
  };
}

/**
 * A hint about how it was paid, and never anything more.
 *
 * This is deliberately not used to choose an account. `VISA ****1234` names a
 * card; which of the user's accounts that card belongs to is a mapping only
 * they can make, and inferring it would attach real money to the wrong
 * account with no signal that anything went wrong.
 */
function extractPaymentMode(normalized: NormalizedReceiptText): ExtractedField<PaymentMode> {
  for (const line of normalized.lines) {
    for (const [mode, phrases] of PAYMENT_HINTS) {
      if (labelHas(line.label, phrases)) return field(mode, 'low', 'payment_keyword');
    }
  }
  for (const line of normalized.lines) {
    if (labelHas(line.label, CARD_BRANDS)) {
      // A brand does not say debit or credit, and this app distinguishes them.
      return missing('card_brand_without_type');
    }
  }
  return missing('no_payment_hint');
}
