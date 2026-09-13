import type { PaymentMode } from '@/db/constants';
import type { LocalDate } from '@/features/recurring/recurring-schedule';

/**
 * The vocabulary of receipt processing.
 *
 * One rule shapes every type here: **OCR output is untrusted**. A receipt is a
 * photograph of a piece of paper, read by a statistical model. Nothing it
 * produces is a fact about someone's money until a person has looked at it and
 * said so, which is why this milestone stops at a *draft* and why every field
 * below can be null.
 *
 * A draft is deliberately not a transaction and deliberately not shaped like
 * one. It never reaches the transactions table, the outbox, reports or budgets.
 * M9B turns a reviewed draft into an expense; until then nothing here moves a
 * single unit of money.
 */

/**
 * How much the extractor trusts one field.
 *
 * Deterministic, and derived only from evidence in the text: a strong label, a
 * competing candidate, an unambiguous separator. It is never a model's own
 * probability — see `ReceiptOcrResult.providerConfidence` for that, which is a
 * different thing and is kept apart on purpose.
 */
export type ReceiptConfidence = 'high' | 'medium' | 'low' | 'none';

/**
 * One extracted value, with why.
 *
 * `basis` is a short machine-readable reason ('strong_total_label',
 * 'ambiguous_numeric_date'). It exists so a reviewer — and M9B's UI — can tell
 * "no date was printed" apart from "a date was printed and could have meant two
 * different days". Both produce `value: null`, and they are not the same thing.
 * It is diagnostic, never shown to users as-is.
 */
export type ExtractedField<T> = {
  value: T | null;
  confidence: ReceiptConfidence;
  basis: string;
};

export function field<T>(
  value: T | null,
  confidence: ReceiptConfidence,
  basis: string,
): ExtractedField<T> {
  return { value, confidence, basis };
}

export function missing<T>(basis: string): ExtractedField<T> {
  return { value: null, confidence: 'none', basis };
}

/**
 * Where a currency came from.
 *
 * The distinction matters more than the value. `default_currency_fallback` is
 * the app's own setting standing in for something the receipt never said, and a
 * review screen has to be able to say so rather than presenting it as read from
 * the paper.
 */
export type CurrencySource =
  'explicit_receipt' | 'symbol_inference' | 'default_currency_fallback' | 'unknown';

export type CurrencyField = ExtractedField<string> & { source: CurrencySource };

/** One amount the parser considered, kept so ambiguity can be shown rather than resolved by guessing. */
export type AmountCandidate = {
  amountMinor: number;
  /** The line it came from, for a reviewer highlighting the receipt. */
  lineIndex: number;
  /** What the line was labelled as: `total`, `subtotal`, `tax`, `change`, `unlabelled`… */
  label: ReceiptLineLabel;
  confidence: ReceiptConfidence;
};

/**
 * What a receipt line appears to be about.
 *
 * The whole amount strategy rests on this: the largest number on a receipt is
 * very often a phone number, an invoice number or the cash handed over, and the
 * total is frequently not the largest at all.
 */
export type ReceiptLineLabel =
  | 'total'
  | 'subtotal'
  | 'tax'
  | 'tip'
  | 'tendered'
  | 'change'
  | 'reference'
  | 'contact'
  | 'card'
  | 'date'
  | 'unlabelled';

/**
 * The output of M9A, and the input to M9B's review screen.
 *
 * `accountId` and `categoryId` are `null` and stay `null`. A receipt cannot know
 * which of someone's accounts paid for it — "VISA ****1234" identifies a card,
 * not an account in this app — and guessing a category from a merchant name is
 * M9C's problem, to be solved deliberately rather than with a lookup table.
 */
export type ReceiptExpenseDraft = {
  /** Always an expense. A receipt is a record of money leaving. */
  transactionType: 'expense';

  amountMinor: ExtractedField<number>;
  currency: CurrencyField;
  transactionDate: ExtractedField<LocalDate>;
  merchantName: ExtractedField<string>;
  /** Non-authoritative, and never used to choose an account. */
  paymentMode: ExtractedField<PaymentMode>;

  /** Never inferred in M9A. M9B asks the user. */
  accountId: null;
  /** Never inferred in M9A. M9C may suggest one. */
  categoryId: null;

  /** Every amount considered, so a review screen can offer a choice when the parser refused to. */
  amountCandidates: AmountCandidate[];

  /** Bumped when extraction logic changes, so an old draft can be recognised as old. */
  parserVersion: number;
};

/**
 * Where a receipt has got to.
 *
 * `failed` carries a reason and no draft. A failure is never expressed as a
 * draft full of zeroes — an expense of 0.00 is a lie that looks like data, and
 * it is exactly the kind of thing that would later be confirmed by a tired
 * person tapping through a review screen.
 */
export type ReceiptProcessingStatus = 'captured' | 'processing' | 'ready_for_review' | 'failed';

export type ReceiptFailureReason =
  | 'no_text_detected'
  | 'unsupported_image'
  | 'image_unavailable'
  | 'ocr_provider_unavailable'
  | 'ocr_failed'
  | 'cancelled';

export const PARSER_VERSION = 1;
