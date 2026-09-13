import type { PaymentMode } from '@/db/constants';
import {
  isLocalDate,
  localDateOf,
  parseLocalDate,
  type LocalDate,
} from '@/features/recurring/recurring-schedule';
import { ConflictError, NotFoundError, ValidationError } from '@/features/shared/errors';
import { MutationsSuspendedError } from '@/features/sync/sync-lock';
import type { CreateExpenseInput } from '@/features/transactions/transaction.types';
import { parseMoneyToMinorUnits } from '@/utils/money';

import type { StoredReceiptDraft } from '../receipt-draft.repository';
import type { CurrencySource } from '../receipt.types';

/**
 * What Review Receipt shows, and what it is allowed to save.
 *
 * The review screen is the one gate between a photograph and money, so the
 * decisions it makes live here as plain functions rather than in a component:
 * what gets prefilled, what gets flagged, what "required" means, and exactly
 * which expense a press of Save Expense asks for. The screen is a thin
 * arrangement of this.
 *
 * Two rules shape everything below.
 *
 * **A default is never presented as a reading.** Today's date standing in for
 * a date the receipt did not print is marked Not detected, so nobody mistakes
 * the app's guess for the paper's evidence.
 *
 * **The person wins.** The moment someone edits a field it stops being a
 * receipt field. Its "needs review" marker goes, and nothing the receipt said
 * is ever put back — clearing a merchant name leaves it cleared.
 */

export type ReviewFieldStatus = 'detected' | 'needs_review' | 'not_detected';

/** Where a value currently shown came from. */
export type ReviewFieldSource = 'receipt' | 'default' | 'user' | 'empty';

export type ReviewField = {
  source: ReviewFieldSource;
  /** What to tell the person about the value. Null once they have set it themselves. */
  status: ReviewFieldStatus | null;
  /** One plain sentence when the receipt said something worth explaining. */
  hint: string | null;
};

export type ReceiptReviewValues = {
  /** A plain decimal string, exactly as `AmountInput` holds it. */
  amountInput: string;
  categoryId: number | null;
  accountId: number | null;
  transactionDate: LocalDate;
  note: string;
  paymentMode: PaymentMode | null;
};

export type ReceiptReviewFields = {
  amount: ReviewField;
  transactionDate: ReviewField;
  note: ReviewField;
  paymentMode: ReviewField;
};

export type ReceiptCurrencyEvidence = {
  code: string | null;
  source: CurrencySource;
  status: ReviewFieldStatus;
};

export type ReceiptReview = {
  draftId: number;
  values: ReceiptReviewValues;
  fields: ReceiptReviewFields;
  currency: ReceiptCurrencyEvidence;
  /** Whether the person has changed anything. Decides whether leaving asks first. */
  edited: boolean;
};

export type EditableField = keyof ReceiptReviewValues;

const CURRENCY_SOURCES: readonly CurrencySource[] = [
  'explicit_receipt',
  'symbol_inference',
  'default_currency_fallback',
  'unknown',
];

const USER_FIELD: ReviewField = { source: 'user', status: null, hint: null };

/** Which editable values carry receipt evidence that an edit replaces. */
const TRACKED: Partial<Record<EditableField, keyof ReceiptReviewFields>> = {
  amountInput: 'amount',
  transactionDate: 'transactionDate',
  note: 'note',
  paymentMode: 'paymentMode',
};

/**
 * Turns a stored draft into the form a person reviews.
 *
 * Category and account are always empty. A receipt cannot say which of
 * someone's accounts paid, and a merchant name is not a category; both are
 * chosen by the person, every time.
 */
export function buildReceiptReview(draft: StoredReceiptDraft, today: Date): ReceiptReview {
  const evidence = draft.confidence ?? {};
  const todayText = localDateOf(today);

  const amountField: ReviewField =
    draft.amountMinor === null
      ? { source: 'empty', status: 'not_detected', hint: amountHint(evidence.amount?.basis) }
      : {
          source: 'receipt',
          status: statusOf(evidence.amount?.confidence),
          hint: amountHint(evidence.amount?.basis),
        };

  let transactionDate: LocalDate;
  let dateField: ReviewField;
  if (draft.transactionDate !== null && isLocalDate(draft.transactionDate)) {
    transactionDate = draft.transactionDate;
    // Probably a misread year. Shown, because the receipt did print it, but
    // never allowed to look settled.
    const future = draft.transactionDate > todayText;
    dateField = {
      source: 'receipt',
      status: future ? 'needs_review' : statusOf(evidence.date?.confidence),
      hint: future ? 'The date on the receipt is later than today. Check the date.' : null,
    };
  } else {
    transactionDate = todayText;
    dateField = {
      source: 'default',
      status: 'not_detected',
      hint:
        evidence.date?.basis === 'ambiguous_numeric_date'
          ? 'The date on the receipt could mean two different days, so today is shown instead.'
          : 'No date was found on the receipt, so today is shown instead.',
    };
  }

  const noteField: ReviewField =
    draft.merchantName === null
      ? { source: 'empty', status: 'not_detected', hint: null }
      : { source: 'receipt', status: statusOf(evidence.merchant?.confidence), hint: null };

  // A payment mode is only ever a suggestion, and an absent one is not worth a
  // "not detected" on an optional field.
  const paymentField: ReviewField =
    draft.paymentMode === null
      ? { source: 'empty', status: null, hint: null }
      : { source: 'receipt', status: 'needs_review', hint: null };

  const source = CURRENCY_SOURCES.find((known) => known === evidence.currency?.source) ?? 'unknown';

  return {
    draftId: draft.id,
    values: {
      amountInput: draft.amountMinor === null ? '' : formatMinorUnitsForInput(draft.amountMinor),
      categoryId: null,
      accountId: null,
      transactionDate,
      note: draft.merchantName ?? '',
      paymentMode: draft.paymentMode,
    },
    fields: {
      amount: amountField,
      transactionDate: dateField,
      note: noteField,
      paymentMode: paymentField,
    },
    currency: {
      code: draft.currency,
      source,
      status:
        draft.currency === null
          ? 'not_detected'
          : source === 'explicit_receipt' && evidence.currency?.confidence === 'high'
            ? 'detected'
            : 'needs_review',
    },
    edited: false,
  };
}

/** Applies one edit. The edited field's receipt evidence is gone for good. */
export function editReview<K extends EditableField>(
  review: ReceiptReview,
  field: K,
  value: ReceiptReviewValues[K],
): ReceiptReview {
  const tracked = TRACKED[field];
  return {
    ...review,
    values: { ...review.values, [field]: value },
    fields: tracked === undefined ? review.fields : { ...review.fields, [tracked]: USER_FIELD },
    edited: true,
  };
}

/**
 * Drops a selection that is no longer offered — an account archived or a
 * category deleted on another device while this receipt was open.
 *
 * Only the selection moves. The amount, date and note the person typed are
 * left exactly as they were: a sync arriving mid-review must never undo work.
 */
export function reconcileSelections(
  review: ReceiptReview,
  available: { accountIds: readonly number[]; categoryIds: readonly number[] },
): ReceiptReview {
  const { accountId, categoryId } = review.values;
  const accountGone = accountId !== null && !available.accountIds.includes(accountId);
  const categoryGone = categoryId !== null && !available.categoryIds.includes(categoryId);
  if (!accountGone && !categoryGone) return review;
  return {
    ...review,
    values: {
      ...review.values,
      accountId: accountGone ? null : accountId,
      categoryId: categoryGone ? null : categoryId,
    },
  };
}

export type ReviewIssues = {
  amount?: string;
  category?: string;
  account?: string;
  date?: string;
};

/**
 * What stands between the form and Save Expense.
 *
 * A first check for the screen, not the last word: the transaction service
 * validates again when Save is pressed, with every rule a typed expense meets.
 * A confident reading of a total can still be refused there, and that refusal
 * wins.
 */
export function reviewIssues(values: ReceiptReviewValues): ReviewIssues {
  const issues: ReviewIssues = {};
  const amountText = values.amountInput.trim();
  if (amountText === '') {
    issues.amount = 'Amount required';
  } else {
    const amountMinor = parseMoneyToMinorUnits(amountText);
    if (amountMinor === null) issues.amount = 'Enter a valid amount with up to 2 decimal places.';
    else if (amountMinor <= 0) issues.amount = 'Enter an amount greater than 0.';
  }
  if (values.categoryId === null) issues.category = 'Category required';
  if (values.accountId === null) issues.account = 'Account required';
  if (!isLocalDate(values.transactionDate)) issues.date = 'Choose a valid date.';
  return issues;
}

export function canSaveReview(values: ReceiptReviewValues): boolean {
  return Object.keys(reviewIssues(values)).length === 0;
}

/** One sentence under a disabled Save Expense, naming what is still missing. */
export function missingSummary(issues: ReviewIssues): string | null {
  const missing: string[] = [];
  if (issues.amount === 'Amount required') missing.push('the amount');
  if (issues.category !== undefined) missing.push('a category');
  if (issues.account !== undefined) missing.push('an account');
  if (missing.length > 0) return `Add ${joinWords(missing)} to save this expense.`;
  return issues.amount ?? issues.date ?? null;
}

/**
 * The expense Save Expense asks for — or null, if the form is not saveable.
 *
 * Whatever the person entered is what is saved, to the minor unit. The
 * receipt's reading is only ever where the form started.
 */
export function toExpenseInput(values: ReceiptReviewValues): CreateExpenseInput | null {
  const amountMinor = parseMoneyToMinorUnits(values.amountInput.trim());
  if (
    amountMinor === null ||
    amountMinor <= 0 ||
    values.categoryId === null ||
    values.accountId === null ||
    !isLocalDate(values.transactionDate)
  ) {
    return null;
  }
  const { year, month, day } = parseLocalDate(values.transactionDate);
  return {
    amountMinor,
    categoryId: values.categoryId,
    accountId: values.accountId,
    // Local midnight on the chosen day, exactly as Add Expense files a date.
    transactionDate: new Date(year, month - 1, day),
    note: values.note.trim() || null,
    paymentMode: values.paymentMode,
  };
}

/**
 * The marker beside a field, in words. A confidently read field gets none:
 * flagging everything is the same as flagging nothing.
 */
export function visibleStatusLabel(field: ReviewField): string | null {
  if (field.status === 'needs_review') return 'Needs review';
  if (field.status === 'not_detected') return 'Not detected';
  return null;
}

/**
 * What a screen reader hears for a field: its name, then the one fact that
 * matters — required and empty, needs review, or not on the receipt.
 */
export function fieldAccessibilityLabel(
  label: string,
  field: ReviewField | null,
  state: { required: boolean; empty: boolean },
): string {
  if (state.required && state.empty) return `${label}, required`;
  if (field === null) return label;
  switch (field.status) {
    case 'needs_review':
      return `${label}, needs review`;
    case 'not_detected':
      return field.source === 'default'
        ? `${label}, not detected on the receipt`
        : `${label}, not detected`;
    case 'detected':
      return `${label}, detected on the receipt`;
    default:
      return label;
  }
}

/**
 * Said when the receipt names a currency the chosen account does not hold.
 *
 * Not a block: an expense takes its account's currency, and that rule is the
 * transaction service's, not this screen's. But this app never converts, so
 * the person is told plainly that 12.50 stays 12.50 in the account's currency.
 * A currency the app only assumed says nothing, because there is no evidence
 * of a mismatch to report.
 */
export function currencyNotice(
  currency: ReceiptCurrencyEvidence,
  account: { name: string; currency: string } | null,
): string | null {
  if (account === null || currency.code === null) return null;
  if (currency.source === 'default_currency_fallback' || currency.source === 'unknown') return null;
  if (currency.code === account.currency) return null;
  return `This receipt looks like ${currency.code}, but ${account.name} records ${account.currency}. The amount will be saved in ${account.currency} as entered, without conversion.`;
}

export type ReviewSaveError = {
  message: string;
  /** A selection the service refused, which the screen clears so a new one is chosen. */
  clear: 'accountId' | 'categoryId' | null;
};

/**
 * A refusal from Save Expense, as something a person can act on.
 *
 * Domain errors already say something true and get a friendlier phrasing
 * where one exists. Anything else — a database fault, a bug — gets one plain
 * sentence and never a stack trace, and the review stays exactly as it was.
 */
export function describeReviewSaveError(error: unknown): ReviewSaveError {
  if (error instanceof ValidationError) {
    if (/active account/i.test(error.message)) {
      return {
        message: 'That account is no longer active. Choose another account.',
        clear: 'accountId',
      };
    }
    if (/require an? expense category/i.test(error.message)) {
      return { message: 'Choose an expense category.', clear: 'categoryId' };
    }
    return { message: error.message, clear: null };
  }
  if (error instanceof NotFoundError) {
    if (/^category/i.test(error.message)) {
      return {
        message: 'That category is no longer available. Choose another category.',
        clear: 'categoryId',
      };
    }
    if (/^account/i.test(error.message)) {
      return {
        message: 'That account is no longer available. Choose another account.',
        clear: 'accountId',
      };
    }
    return { message: error.message, clear: null };
  }
  if (error instanceof ConflictError || error instanceof MutationsSuspendedError) {
    return { message: error.message, clear: null };
  }
  return { message: 'We couldn’t save this expense. Try again.', clear: null };
}

/** `101700` → `1017.00`, by string slicing so no float ever touches it. */
export function formatMinorUnitsForInput(minorUnits: number): string {
  const digits = String(minorUnits).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function statusOf(confidence: string | undefined): ReviewFieldStatus {
  return confidence === 'high' ? 'detected' : 'needs_review';
}

function amountHint(basis: string | undefined): string | null {
  switch (basis) {
    case 'conflicting_total_labels':
      return 'The receipt shows more than one total. Enter the amount you paid.';
    case 'subtotal_only':
      return 'Only a subtotal was found. Check it against what you paid.';
    case 'largest_unlabelled_amount':
      return 'No total was labelled on the receipt. Check this amount.';
    default:
      return null;
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
