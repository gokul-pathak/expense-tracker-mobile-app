import {
  field,
  missing,
  type AmountCandidate,
  type ExtractedField,
  type ReceiptConfidence,
  type ReceiptLineLabel,
} from '../receipt.types';

import { findMoneyTokens, type MoneyReading } from './receipt-money';
import { labelHas, type NormalizedReceiptText, type ReceiptLine } from './receipt-text';

/**
 * Which number on the receipt is the amount.
 *
 * This is the field that matters. Everything else on a draft can be wrong and
 * a reviewer will notice; an amount that is wrong by a plausible-looking sum
 * is the one mistake that survives review and becomes someone's financial record. So
 * the strategy is labels first, never size.
 *
 * The largest number on a receipt is routinely the phone number, the invoice
 * number, or the cash handed over — on the classic
 * `TOTAL 500 / CASH 1000 / CHANGE 500` layout, picking the biggest gives twice
 * the right answer. What actually identifies the total is the word next to it.
 *
 * When two strong totals disagree, this refuses. An ambiguous draft that asks
 * a person is worth far more than a confident one that is sometimes wrong.
 */

/**
 * Checked in order, and the order is load-bearing: `SUB TOTAL` contains the
 * word `TOTAL`, so subtotal has to be recognised first or every subtotal on
 * every receipt would be read as the total.
 */
const LABELS: readonly (readonly [ReceiptLineLabel, readonly string[]])[] = [
  ['subtotal', ['SUBTOTAL', 'SUB TOTAL', 'SUBTOTAI']],
  // A tax *identifier* is a reference number, not a tax amount — `VAT NO` has
  // to beat `VAT`, and neither may be read as a total.
  [
    'reference',
    [
      'INVOICE',
      'INVOICE NO',
      'BILL NO',
      'RECEIPT NO',
      'ORDER',
      'ORDER NO',
      'REF',
      'REF NO',
      'VAT NO',
      'PAN',
      'PAN NO',
      'TAX ID',
      'TIN',
      'TABLE',
    ],
  ],
  ['contact', ['PHONE', 'PH', 'TEL', 'TELEPHONE', 'MOBILE', 'FAX', 'CONTACT']],
  [
    'card',
    [
      'VISA',
      'MASTERCARD',
      'MASTER CARD',
      'MAESTRO',
      'AMEX',
      'CARD',
      'CARD NO',
      'EXPIRY',
      'EXP',
      'VALID THRU',
      'AUTH',
      'APPROVAL',
    ],
  ],
  ['tip', ['TIP', 'GRATUITY', 'SERVICE CHARGE']],
  ['change', ['CHANGE', 'CHANGE DUE', 'RETURN']],
  ['tendered', ['CASH', 'CASH TENDERED', 'TENDERED', 'AMOUNT PAID', 'AMOUNT TENDERED']],
  [
    'total',
    [
      'GRAND TOTAL',
      'NET TOTAL',
      'TOTAL DUE',
      'AMOUNT DUE',
      'BALANCE DUE',
      'TOTAL AMOUNT',
      'NET PAYABLE',
      'NET AMOUNT',
      'TOTAL',
    ],
  ],
  ['tax', ['VAT', 'TAX', 'GST', 'CGST', 'SGST', 'SERVICE TAX']],
];

/**
 * Labels whose digits are not money at all.
 *
 * These are never even recorded as candidates. A phone number and the last
 * four digits of a card are not amounts a reviewer could ever want to pick,
 * and putting them in front of someone as selectable figures would be both
 * useless and — for the card fragment — a privacy leak out of the raw text
 * this milestone promises to keep contained.
 */
const NOT_MONEY: ReadonlySet<ReceiptLineLabel> = new Set(['reference', 'contact', 'card', 'date']);

/**
 * Labels that are real money but are not what was paid.
 *
 * These stay in the candidate list, because a person reviewing a receipt may
 * legitimately want the subtotal or the tax — they are just never selected
 * automatically.
 */
const NEVER_THE_AMOUNT: ReadonlySet<ReceiptLineLabel> = new Set([
  ...NOT_MONEY,
  'change',
  'tendered',
  'tax',
  'tip',
]);

const RANK: Record<ReceiptConfidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** Never report more confidence than the weakest link in the reasoning. */
function weakest(...values: ReceiptConfidence[]): ReceiptConfidence {
  return values.reduce((lowest, value) => (RANK[value] < RANK[lowest] ? value : lowest), 'high');
}

export function classifyLine(line: ReceiptLine, looksLikeDate: boolean): ReceiptLineLabel {
  for (const [label, phrases] of LABELS) {
    if (labelHas(line.label, phrases)) return label;
  }
  // A printed date is full of two- and four-digit numbers that are not money.
  return looksLikeDate ? 'date' : 'unlabelled';
}

export type AmountExtraction = {
  amountMinor: ExtractedField<number>;
  candidates: AmountCandidate[];
};

export function extractAmount(
  normalized: NormalizedReceiptText,
  labels: ReceiptLineLabel[],
): AmountExtraction {
  const candidates: AmountCandidate[] = [];

  for (const line of normalized.lines) {
    const label = labels[line.index] ?? 'unlabelled';
    // Digits on these lines are identifiers, not figures, so they never enter
    // the candidate list in the first place.
    if (NOT_MONEY.has(label)) continue;

    const reading = rightmostReading(line.text);

    if (reading !== null) {
      candidates.push({
        amountMinor: reading.amountMinor,
        lineIndex: line.index,
        label,
        confidence: reading.confidence,
      });
      continue;
    }

    // A label with no number beside it: many receipts print the word and the
    // figure on separate lines. Only a total earns this lookahead, and only
    // onto a line that carries no label of its own.
    if (label !== 'total') continue;
    const next = normalized.lines[line.index + 1];
    if (next === undefined || (labels[next.index] ?? 'unlabelled') !== 'unlabelled') continue;
    const adjacent = rightmostReading(next.text);
    if (adjacent === null) continue;
    candidates.push({
      amountMinor: adjacent.amountMinor,
      lineIndex: next.index,
      label: 'total',
      confidence: weakest(adjacent.confidence, 'medium'),
    });
  }

  return { amountMinor: select(candidates), candidates };
}

function select(candidates: AmountCandidate[]): ExtractedField<number> {
  const totals = candidates.filter((candidate) => candidate.label === 'total');
  if (totals.length > 0) {
    const distinct = new Set(totals.map((candidate) => candidate.amountMinor));
    if (distinct.size > 1) {
      // Two lines both claim to be the total and disagree. Choosing between
      // them would be a coin toss dressed up as extraction.
      return missing('conflicting_total_labels');
    }
    const best = totals.reduce((strongest, candidate) =>
      RANK[candidate.confidence] > RANK[strongest.confidence] ? candidate : strongest,
    );
    return field(best.amountMinor, best.confidence, 'strong_total_label');
  }

  const subtotals = candidates.filter((candidate) => candidate.label === 'subtotal');
  if (subtotals.length > 0) {
    const distinct = new Set(subtotals.map((candidate) => candidate.amountMinor));
    if (distinct.size > 1) return missing('conflicting_subtotals');
    // A subtotal is the total before tax, so it is usually *not* what was paid.
    // Better than nothing, and never better than low.
    return field(subtotals[0]!.amountMinor, 'low', 'subtotal_only');
  }

  const plain = candidates.filter(
    (candidate) => !NEVER_THE_AMOUNT.has(candidate.label) && candidate.confidence !== 'low',
  );
  if (plain.length === 0) return missing('no_amount_candidate');

  // Last resort, and explicitly the weakest reasoning available: no label
  // vouched for any number, so the largest plausible one is a guess.
  const largest = plain.reduce((biggest, candidate) =>
    candidate.amountMinor > biggest.amountMinor ? candidate : biggest,
  );
  return field(largest.amountMinor, 'low', 'largest_unlabelled_amount');
}

/**
 * Receipts are a two-column layout: the words on the left, the figure on the
 * right. When a line holds several numbers the rightmost is the value.
 */
function rightmostReading(lineText: string): MoneyReading | null {
  const tokens = findMoneyTokens(lineText);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const reading = tokens[index]!.reading;
    if (reading !== null) return reading;
  }
  return null;
}
