import { describe, expect, it } from 'vitest';

import {
  extractReceiptDraft,
  type ReceiptExtractionContext,
} from '@/features/receipts/extraction/receipt-extraction';
import { readMoneyToken } from '@/features/receipts/extraction/receipt-money';

/**
 * The receipt parser, pinned receipt by receipt.
 *
 * Every fixture here is written out as OCR would hand it over — the merchant
 * line, the noise, the labels in the order a printer emits them. They are
 * synthetic: no real receipt, and so no real person's address, card fragment
 * or loyalty number, is committed to this repository.
 *
 * These tests never touch a camera, a file or an OCR engine. The parser is a
 * pure function of text and context, which is what makes a receipt a
 * specification rather than a screenshot.
 */

const CONTEXT: ReceiptExtractionContext = {
  defaultCurrency: 'NPR',
  currentLocalDate: '2026-09-12',
  supportedCurrencies: ['NPR', 'USD', 'INR'],
};

const parse = (text: string, overrides: Partial<ReceiptExtractionContext> = {}) =>
  extractReceiptDraft(text, { ...CONTEXT, ...overrides });

describe('the standard receipt', () => {
  const RECEIPT = `ABC STORE
12 SEP 2026

SUBTOTAL 900.00
VAT 117.00
TOTAL NPR 1,017.00

THANK YOU`;

  it('reads the total, the merchant, the currency and the date', () => {
    const draft = parse(RECEIPT);

    expect(draft.amountMinor.value).toBe(101_700);
    expect(draft.amountMinor.confidence).toBe('high');
    expect(draft.amountMinor.basis).toBe('strong_total_label');

    expect(draft.merchantName.value).toBe('ABC STORE');
    expect(draft.merchantName.confidence).toBe('high');

    expect(draft.currency.value).toBe('NPR');
    expect(draft.currency.source).toBe('explicit_receipt');
    expect(draft.currency.confidence).toBe('high');

    expect(draft.transactionDate.value).toBe('2026-09-12');
    expect(draft.transactionDate.confidence).toBe('high');
  });

  it('takes the total rather than the subtotal or the tax', () => {
    const draft = parse(RECEIPT);
    const amounts = draft.amountCandidates.map((candidate) => candidate.amountMinor);

    // Both were seen and neither was chosen.
    expect(amounts).toContain(90_000);
    expect(amounts).toContain(11_700);
    expect(draft.amountMinor.value).toBe(101_700);
  });

  it('guesses no account and no category, ever', () => {
    const draft = parse(RECEIPT);
    expect(draft.accountId).toBeNull();
    expect(draft.categoryId).toBeNull();
    expect(draft.transactionType).toBe('expense');
  });
});

describe('amounts that are not the total', () => {
  it('ignores the cash tendered and the change', () => {
    const draft = parse(`CAFE
TOTAL 500.00
CASH 1000.00
CHANGE 500.00`);

    // The largest number on this receipt is twice the bill.
    expect(draft.amountMinor.value).toBe(50_000);
    expect(draft.amountMinor.confidence).toBe('high');
  });

  it('prefers a grand total over the subtotal and the tax it is made of', () => {
    const draft = parse(`SUBTOTAL 1,000.00
VAT 130.00
GRAND TOTAL 1,130.00`);

    expect(draft.amountMinor.value).toBe(113_000);
  });

  it('never reads a phone number as money', () => {
    const draft = parse(`Phone: 9812345678
TOTAL 650.00`);

    expect(draft.amountMinor.value).toBe(65_000);
    expect(draft.amountCandidates.every((c) => c.amountMinor !== 981_234_567_800)).toBe(true);
  });

  it('never reads an invoice number as money', () => {
    const draft = parse(`Invoice 123456
Total 450.00`);

    expect(draft.amountMinor.value).toBe(45_000);
  });

  it('refuses to choose between two totals that disagree', () => {
    const draft = parse(`TOTAL 1,050
GRAND TOTAL 7,050`);

    // Picking either would be a coin toss presented as a reading.
    expect(draft.amountMinor.value).toBeNull();
    expect(draft.amountMinor.basis).toBe('conflicting_total_labels');
    expect(draft.amountCandidates.map((c) => c.amountMinor).sort()).toEqual([105_000, 705_000]);
  });

  it('falls back to a subtotal only when nothing better exists, and says so', () => {
    const draft = parse(`SHOP
SUBTOTAL 1,000.00`);

    expect(draft.amountMinor.value).toBe(100_000);
    expect(draft.amountMinor.confidence).toBe('low');
    expect(draft.amountMinor.basis).toBe('subtotal_only');
  });

  it('produces no amount at all from a receipt with no numbers', () => {
    const draft = parse(`CORNER SHOP
THANK YOU FOR VISITING`);

    expect(draft.amountMinor.value).toBeNull();
    expect(draft.amountMinor.confidence).toBe('none');
  });
});

describe('money formats', () => {
  const minor = (token: string) => readMoneyToken(token)?.amountMinor ?? null;

  it('reads the unambiguous grouped forms exactly', () => {
    expect(minor('123')).toBe(12_300);
    expect(minor('123.45')).toBe(12_345);
    expect(minor('1,234.56')).toBe(123_456);
    expect(minor('1.234,56')).toBe(123_456);
    expect(minor('1 234.56')).toBe(123_456);
    expect(minor('1,24,500.00')).toBe(12_450_000); // lakh grouping, as NPR and INR print it
  });

  it('treats a lone three-digit group as ambiguous rather than picking a locale', () => {
    const reading = readMoneyToken('1.234');
    expect(reading?.amountMinor).toBe(123_400);
    // 1.234 is 1234 grouped or 1.234 with three decimals. Read as grouped and
    // marked, never promoted to a confident total on its own.
    expect(reading?.confidence).toBe('low');
    expect(reading?.basis).toBe('ambiguous_three_digit_group');
  });

  it('refuses a negative token rather than inventing a negative expense', () => {
    expect(readMoneyToken('-500.00')).toBeNull();
  });

  it('refuses anything past the safe integer range', () => {
    expect(readMoneyToken('999999999999999999')).toBeNull();
  });

  it('flags a bare long digit run instead of trusting it', () => {
    expect(readMoneyToken('9812345678')?.confidence).toBe('low');
  });
});

describe('dates', () => {
  it('reads an ISO date with confidence', () => {
    const draft = parse(`SHOP
2026-09-12
TOTAL 100.00`);
    expect(draft.transactionDate.value).toBe('2026-09-12');
    expect(draft.transactionDate.confidence).toBe('high');
  });

  it('refuses an ambiguous numeric date, and says it was ambiguous', () => {
    const draft = parse(`SHOP
03/04/2026
TOTAL 100.00`);

    // Could be 3 April or 4 March. The receipt does not say which.
    expect(draft.transactionDate.value).toBeNull();
    expect(draft.transactionDate.basis).toBe('ambiguous_numeric_date');
    expect(draft.transactionDate.confidence).not.toBe('high');
  });

  it('resolves a numeric date when one component can only be a day', () => {
    const draft = parse(`SHOP
25/12/2025
TOTAL 100.00`);
    expect(draft.transactionDate.value).toBe('2025-12-25');
  });

  it('leaves a missing date missing rather than substituting today', () => {
    const draft = parse(`SHOP
TOTAL 100.00`);

    expect(draft.transactionDate.value).toBeNull();
    expect(draft.transactionDate.basis).toBe('no_date_found');
  });

  it('rejects a day that does not exist instead of rolling it forward', () => {
    const draft = parse(`SHOP
2026-02-31
TOTAL 100.00`);
    expect(draft.transactionDate.value).toBeNull();
  });

  it('does not mistake a card expiry for the purchase date', () => {
    const draft = parse(`SHOP
2026-09-12
VISA VALID THRU 09/28
TOTAL 100.00`);
    expect(draft.transactionDate.value).toBe('2026-09-12');
  });

  it('keeps a future date but lowers its confidence', () => {
    const draft = parse(`SHOP
2027-01-05
TOTAL 100.00`);

    // Probably OCR damage, but silently rewriting it to today would invent a
    // date that appears on no receipt.
    expect(draft.transactionDate.value).toBe('2027-01-05');
    expect(draft.transactionDate.confidence).toBe('medium');
    expect(draft.transactionDate.basis).toContain('future');
  });
});

describe('currency', () => {
  it('offers the app default when the receipt names none, labelled as a fallback', () => {
    const draft = parse(`SHOP
TOTAL 1,250.00`);

    expect(draft.currency.value).toBe('NPR');
    expect(draft.currency.source).toBe('default_currency_fallback');
    expect(draft.currency.confidence).toBe('low');
  });

  it('does not turn an ambiguous rupee symbol into a country', () => {
    const draft = parse(`SHOP
TOTAL Rs 1,250.00`);

    // Rs is Nepal and India both. The symbol settles nothing, so this is the
    // default standing in, not a reading.
    expect(draft.currency.source).toBe('default_currency_fallback');
  });

  it('infers a currency from a symbol only when one supported currency uses it', () => {
    const draft = parse(`SHOP
TOTAL $ 12.50`);

    expect(draft.currency.value).toBe('USD');
    expect(draft.currency.source).toBe('symbol_inference');
    expect(draft.currency.confidence).toBe('low');
  });

  it('reads an explicit code as read from the receipt', () => {
    const draft = parse(`SHOP
TOTAL USD 12.50`);
    expect(draft.currency.value).toBe('USD');
    expect(draft.currency.source).toBe('explicit_receipt');
  });

  it('reports nothing when two currency codes appear', () => {
    const draft = parse(`SHOP
TOTAL USD 12.50
NPR 1,650.00`);
    expect(draft.currency.value).toBeNull();
    expect(draft.currency.source).toBe('unknown');
  });
});

describe('merchant', () => {
  it('takes the header line', () => {
    expect(parse('ABC STORE\nTOTAL 10.00').merchantName.value).toBe('ABC STORE');
  });

  it('never uses boilerplate, a phone number or a tax id as a name', () => {
    const draft = parse(`THANK YOU
VAT NO 601234567
Phone: 9812345678
TOTAL 100.00`);

    expect(draft.merchantName.value).toBeNull();
    expect(draft.merchantName.confidence).toBe('none');
  });

  it('skips an address line to reach the name', () => {
    const draft = parse(`GREEN GROCER
123 NEW ROAD
TOTAL 100.00`);
    expect(draft.merchantName.value).toBe('GREEN GROCER');
  });
});

describe('OCR noise', () => {
  it('recovers a total whose label and figure were misread, at lower confidence', () => {
    const draft = parse(`ABC STORE
T0TAL
1O17.00`);

    // `T0TAL` is corrected only in the label projection, and `1O17.00` only
    // inside a token that is already mostly digits — never across the line,
    // which would turn the merchant into `C0STC0`.
    expect(draft.amountMinor.value).toBe(101_700);
    expect(draft.amountMinor.confidence).toBe('medium');
    expect(draft.merchantName.value).toBe('ABC STORE');
  });
});

describe('payment mode', () => {
  it('reports cash when the receipt says cash', () => {
    expect(parse('SHOP\nTOTAL 100.00\nCASH 100.00').paymentMode.value).toBe('cash');
  });

  it('refuses to pick debit or credit from a card brand alone', () => {
    const draft = parse(`SHOP
TOTAL 100.00
VISA ****1234`);

    expect(draft.paymentMode.value).toBeNull();
    expect(draft.paymentMode.basis).toBe('card_brand_without_type');
    // And the card digits reach no field of the draft.
    expect(JSON.stringify(draft)).not.toContain('1234');
  });
});
