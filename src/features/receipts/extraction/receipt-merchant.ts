import { field, missing, type ExtractedField, type ReceiptLineLabel } from '../receipt.types';

import { labelHas, type NormalizedReceiptText } from './receipt-text';

/**
 * Who was paid.
 *
 * Merchant names live in the header, but so does everything else a shop wants
 * on its paper: the address, the phone number, the tax registration, and a
 * cheerful greeting. Filling this field with `THANK YOU` or `VAT NO 601234567`
 * is worse than leaving it empty, because a reviewer skims a filled field and
 * corrects an empty one.
 *
 * So this is a filter, not a search. It walks the top of the receipt and
 * returns the first line that still looks like a name once everything
 * recognisably not-a-name has been removed.
 */

/** Only the header is considered. A name printed halfway down is a line item. */
const HEADER_DEPTH = 6;

/** Boilerplate that appears where a name would be. */
const BOILERPLATE = [
  'THANK YOU',
  'THANKS',
  'WELCOME',
  'INVOICE',
  'TAX INVOICE',
  'RECEIPT',
  'CASH RECEIPT',
  'CASH MEMO',
  'BILL',
  'ESTIMATE',
  'QUOTATION',
  'CUSTOMER COPY',
  'MERCHANT COPY',
  'DUPLICATE',
  'ORIGINAL',
  'VAT NO',
  'PAN NO',
  'PAN',
  'TAX ID',
  'TIN',
  'GSTIN',
  'PHONE',
  'TEL',
  'TELEPHONE',
  'MOBILE',
  'FAX',
  'EMAIL',
  'WWW',
  'HTTP',
  'DATE',
  'TIME',
  'CASHIER',
  'SERVED BY',
  'TABLE',
  'ORDER',
  'TERMINAL',
];

/** Words that make a line an address rather than a name. */
const ADDRESS_WORDS = [
  'STREET',
  'ROAD',
  'AVENUE',
  'AVE',
  'LANE',
  'MARG',
  'TOLE',
  'WARD',
  'CHOWK',
  'FLOOR',
  'SUITE',
  'BLOCK',
  'SECTOR',
  'P O BOX',
  'POBOX',
  'ZIP',
  'POSTAL',
];

export function extractMerchant(
  normalized: NormalizedReceiptText,
  labels: ReceiptLineLabel[],
): ExtractedField<string> {
  const header = normalized.lines.slice(0, HEADER_DEPTH);

  for (const line of header) {
    const label = labels[line.index] ?? 'unlabelled';
    // Anything the amount parser recognised as a money or reference line is a
    // figure with a caption, not the shop's name.
    if (label !== 'unlabelled') continue;
    if (!looksLikeName(line.text, line.label)) continue;

    // The top line of a receipt is the name far more often than any other, and
    // confidence should say plainly how much of a guess this is.
    const confidence = line.index === 0 ? 'high' : line.index <= 2 ? 'medium' : 'low';
    return field(tidy(line.text), confidence, `header_line_${line.index}`);
  }

  return missing('no_merchant_candidate');
}

function looksLikeName(text: string, label: string): boolean {
  if (labelHas(label, BOILERPLATE) || labelHas(label, ADDRESS_WORDS)) return false;

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const digits = (text.match(/\d/gu) ?? []).length;

  // A name is mostly letters. Two characters is the shortest plausible shop
  // name; below that it is an initial or OCR debris.
  if (letters < 2) return false;
  // Addresses and registration numbers are letters *and* a lot of digits.
  if (digits > letters) return false;
  // A line that is mostly punctuation is a separator rule, not a name.
  return letters >= text.replace(/\s/g, '').length / 2;
}

/** Trims the decorative punctuation receipts print around a name. */
function tidy(text: string): string {
  return text
    .replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
