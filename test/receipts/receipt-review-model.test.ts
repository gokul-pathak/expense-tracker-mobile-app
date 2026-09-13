import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import type { StoredReceiptDraft } from '@/features/receipts/receipt-draft.repository';
import {
  buildReceiptReview,
  canSaveReview,
  currencyNotice,
  describeReviewSaveError,
  editReview,
  fieldAccessibilityLabel,
  formatMinorUnitsForInput,
  missingSummary,
  reconcileSelections,
  reviewIssues,
  toExpenseInput,
  visibleStatusLabel,
} from '@/features/receipts/review/receipt-review.model';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

/**
 * Review Receipt's decisions, as data.
 *
 * What is prefilled, what is flagged, what "required" means and exactly which
 * expense Save Expense asks for. The screen renders these values and nothing
 * else, so every rule the milestone gives the review gate is asserted here.
 */

const TODAY = new Date(2026, 8, 13, 10, 0, 0);

function draft(overrides: Partial<StoredReceiptDraft> = {}): StoredReceiptDraft {
  return {
    id: 7,
    imageUri: 'file:///private/receipt-processing/a.jpg',
    status: 'ready_for_review',
    failureReason: null,
    merchantName: 'ABC STORE',
    amountMinor: 101_700,
    currency: 'NPR',
    transactionDate: '2026-09-12',
    paymentMode: null,
    confidence: {
      amount: { confidence: 'high', basis: 'strong_total_label' },
      currency: { confidence: 'high', basis: 'explicit_currency_code', source: 'explicit_receipt' },
      date: { confidence: 'high', basis: 'month_name' },
      merchant: { confidence: 'high', basis: 'header_line_0' },
    },
    parserVersion: 1,
    ocrProvider: 'fake-ocr',
    processingGeneration: 1,
    createdAt: TODAY,
    updatedAt: TODAY,
    expiresAt: null,
    finalizedTransactionId: null,
    finalizedAt: null,
    ...overrides,
  };
}

describe('prefilling from a confident reading', () => {
  it('fills amount, date and merchant, and marks none of them', () => {
    const review = buildReceiptReview(draft(), TODAY);

    expect(review.values).toEqual({
      amountInput: '1017.00',
      categoryId: null,
      accountId: null,
      transactionDate: '2026-09-12',
      note: 'ABC STORE',
      paymentMode: null,
    });
    // Confident fields carry no warning: flagging everything flags nothing.
    expect(visibleStatusLabel(review.fields.amount)).toBeNull();
    expect(visibleStatusLabel(review.fields.transactionDate)).toBeNull();
    expect(visibleStatusLabel(review.fields.note)).toBeNull();
  });

  it('never chooses a category or an account, however obvious the receipt looks', () => {
    const review = buildReceiptReview(
      draft({ merchantName: 'CITY PHARMACY', paymentMode: 'credit_card' }),
      TODAY,
    );
    expect(review.values.categoryId).toBeNull();
    expect(review.values.accountId).toBeNull();
    // Nothing is saveable until the person chooses both.
    expect(canSaveReview(review.values)).toBe(false);
  });
});

describe('uncertain and missing amounts', () => {
  it('starts empty when no amount was read, and requires one', () => {
    const review = buildReceiptReview(
      draft({
        amountMinor: null,
        confidence: { amount: { confidence: 'none', basis: 'no_amount_candidate' } },
      }),
      TODAY,
    );

    // Never 0: an empty field that must be filled, not a figure.
    expect(review.values.amountInput).toBe('');
    expect(visibleStatusLabel(review.fields.amount)).toBe('Not detected');
    expect(reviewIssues({ ...review.values, categoryId: 1, accountId: 2 }).amount).toBe(
      'Amount required',
    );
    expect(canSaveReview({ ...review.values, categoryId: 1, accountId: 2 })).toBe(false);
    expect(
      fieldAccessibilityLabel('Amount', review.fields.amount, { required: true, empty: true }),
    ).toBe('Amount, required');
  });

  it('explains conflicting totals instead of picking one', () => {
    const review = buildReceiptReview(
      draft({
        amountMinor: null,
        confidence: { amount: { confidence: 'none', basis: 'conflicting_total_labels' } },
      }),
      TODAY,
    );
    expect(review.fields.amount.hint).toBe(
      'The receipt shows more than one total. Enter the amount you paid.',
    );
  });

  it('shows a low-confidence amount as a suggestion that needs review, in words', () => {
    const review = buildReceiptReview(
      draft({ confidence: { amount: { confidence: 'low', basis: 'subtotal_only' } } }),
      TODAY,
    );

    expect(review.values.amountInput).toBe('1017.00');
    expect(visibleStatusLabel(review.fields.amount)).toBe('Needs review');
    expect(review.fields.amount.hint).toBe(
      'Only a subtotal was found. Check it against what you paid.',
    );
    // Not colour alone: a screen reader hears it too.
    expect(
      fieldAccessibilityLabel('Amount', review.fields.amount, { required: true, empty: false }),
    ).toBe('Amount, needs review');
  });
});

describe('dates', () => {
  it('shows today for a missing date, and never calls it detected', () => {
    const review = buildReceiptReview(draft({ transactionDate: null }), TODAY);

    expect(review.values.transactionDate).toBe('2026-09-13');
    expect(review.fields.transactionDate.source).toBe('default');
    expect(visibleStatusLabel(review.fields.transactionDate)).toBe('Not detected');
    expect(
      fieldAccessibilityLabel('Date', review.fields.transactionDate, {
        required: true,
        empty: false,
      }),
    ).toBe('Date, not detected on the receipt');
  });

  it('says why an ambiguous date became today', () => {
    const review = buildReceiptReview(
      draft({
        transactionDate: null,
        confidence: { date: { confidence: 'none', basis: 'ambiguous_numeric_date' } },
      }),
      TODAY,
    );
    expect(review.fields.transactionDate.hint).toBe(
      'The date on the receipt could mean two different days, so today is shown instead.',
    );
  });

  it('flags a receipt date later than today rather than trusting it', () => {
    const review = buildReceiptReview(draft({ transactionDate: '2027-01-05' }), TODAY);
    expect(review.values.transactionDate).toBe('2027-01-05');
    expect(visibleStatusLabel(review.fields.transactionDate)).toBe('Needs review');
  });
});

describe('the person wins', () => {
  it('saves exactly the amount the person typed over the receipt’s reading', () => {
    let review = buildReceiptReview(draft(), TODAY);
    review = editReview(review, 'amountInput', '1200');
    review = editReview(review, 'categoryId', 3);
    review = editReview(review, 'accountId', 5);

    // Once edited, it is no longer a receipt field, and is not flagged as one.
    expect(review.fields.amount).toEqual({ source: 'user', status: null, hint: null });
    expect(review.edited).toBe(true);

    const input = toExpenseInput(review.values);
    expect(input?.amountMinor).toBe(120_000);
    expect(input?.categoryId).toBe(3);
    expect(input?.accountId).toBe(5);
  });

  it('keeps a cleared merchant cleared, and saves no note', () => {
    let review = buildReceiptReview(draft(), TODAY);
    review = editReview(review, 'note', '');
    review = editReview(review, 'categoryId', 3);
    review = editReview(review, 'accountId', 5);

    expect(review.values.note).toBe('');
    expect(toExpenseInput(review.values)?.note).toBeNull();
  });

  it('files the chosen date at local midnight, as Add Expense does', () => {
    let review = buildReceiptReview(draft(), TODAY);
    review = editReview(review, 'transactionDate', '2026-08-31');
    review = editReview(review, 'categoryId', 3);
    review = editReview(review, 'accountId', 5);

    expect(toExpenseInput(review.values)?.transactionDate).toEqual(new Date(2026, 7, 31));
  });

  it('refuses to build an expense from an incomplete form', () => {
    const review = buildReceiptReview(draft(), TODAY);
    expect(toExpenseInput(review.values)).toBeNull();
    expect(missingSummary(reviewIssues(review.values))).toBe(
      'Add a category and an account to save this expense.',
    );
  });

  it('names every missing piece in one sentence', () => {
    const review = buildReceiptReview(draft({ amountMinor: null }), TODAY);
    expect(missingSummary(reviewIssues(review.values))).toBe(
      'Add the amount, a category and an account to save this expense.',
    );
  });
});

describe('selections that disappear mid-review', () => {
  it('drops an archived account without touching what was typed', () => {
    let review = buildReceiptReview(draft(), TODAY);
    review = editReview(review, 'amountInput', '999.50');
    review = editReview(review, 'accountId', 5);
    review = editReview(review, 'categoryId', 3);

    const reconciled = reconcileSelections(review, { accountIds: [6], categoryIds: [3] });

    expect(reconciled.values.accountId).toBeNull();
    expect(reconciled.values.categoryId).toBe(3);
    expect(reconciled.values.amountInput).toBe('999.50');
  });

  it('returns the same review when nothing was removed', () => {
    const review = editReview(buildReceiptReview(draft(), TODAY), 'accountId', 5);
    expect(reconcileSelections(review, { accountIds: [5], categoryIds: [] })).toBe(review);
  });
});

describe('currency', () => {
  const npr = { name: 'Cash', currency: 'NPR' };

  it('warns, without converting, when the receipt names another currency', () => {
    const review = buildReceiptReview(
      draft({
        currency: 'USD',
        confidence: {
          currency: {
            confidence: 'high',
            basis: 'explicit_currency_code',
            source: 'explicit_receipt',
          },
        },
      }),
      TODAY,
    );
    expect(currencyNotice(review.currency, npr)).toBe(
      'This receipt looks like USD, but Cash records NPR. The amount will be saved in NPR as entered, without conversion.',
    );
  });

  it('says nothing when the currency was only the app’s default', () => {
    const review = buildReceiptReview(
      draft({
        currency: 'USD',
        confidence: {
          currency: {
            confidence: 'low',
            basis: 'default_currency_setting',
            source: 'default_currency_fallback',
          },
        },
      }),
      TODAY,
    );
    expect(currencyNotice(review.currency, npr)).toBeNull();
  });

  it('says nothing when the currencies agree, or before an account is chosen', () => {
    const review = buildReceiptReview(draft(), TODAY);
    expect(currencyNotice(review.currency, npr)).toBeNull();
    expect(currencyNotice(review.currency, null)).toBeNull();
  });
});

describe('save refusals', () => {
  it('asks for a new account when the chosen one was archived', () => {
    expect(describeReviewSaveError(new ValidationError('Choose an active account.'))).toEqual({
      message: 'That account is no longer active. Choose another account.',
      clear: 'accountId',
    });
  });

  it('asks for a new category when the chosen one is gone', () => {
    expect(describeReviewSaveError(new NotFoundError('Category 9 was not found.'))).toEqual({
      message: 'That category is no longer available. Choose another category.',
      clear: 'categoryId',
    });
  });

  it('shows one plain sentence for anything unexpected, never the error itself', () => {
    const result = describeReviewSaveError(new Error('SQLITE_BUSY: database is locked'));
    expect(result).toEqual({ message: 'We couldn’t save this expense. Try again.', clear: null });
    expect(result.message).not.toContain('SQLITE');
  });
});

describe('amount formatting', () => {
  it('formats minor units for the input exactly, without floating point', () => {
    expect(formatMinorUnitsForInput(101_700)).toBe('1017.00');
    expect(formatMinorUnitsForInput(5)).toBe('0.05');
    expect(formatMinorUnitsForInput(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  });
});
