import {
  MAX_RECURRENCE_INTERVAL,
  PAYMENT_MODES,
  RECURRING_FREQUENCIES,
  RECURRING_TRANSACTION_TYPES,
  type PaymentMode,
  type RecurringFrequency,
  type RecurringTransactionType,
} from '@/db/constants';
import { ValidationError } from '@/features/shared/errors';

import { isLocalDate, type LocalDate } from './recurring-schedule';
import type { RecurringBlockedReason } from './recurring.types';

/**
 * What makes a template well-formed.
 *
 * These mirror the rules an ordinary expense or income is created under, because
 * that is what a template becomes: an amount that is a positive safe integer of
 * minor units, a category of the matching type, an active account whose currency
 * the transaction takes. Generation re-checks all of it through the transaction
 * service itself, so a template that went stale between creation and its due
 * date cannot produce a transaction the app would have refused by hand.
 */

export function normalizeRecurringType(value: unknown): RecurringTransactionType {
  if (typeof value !== 'string' || !RECURRING_TRANSACTION_TYPES.includes(value as never)) {
    throw new ValidationError('Only expenses and income can repeat.');
  }
  return value as RecurringTransactionType;
}

export function normalizeAmountMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Amount must be a positive integer number of minor units.');
  }
  return value;
}

export function normalizeFrequency(value: unknown): RecurringFrequency {
  if (typeof value !== 'string' || !RECURRING_FREQUENCIES.includes(value as never)) {
    throw new ValidationError('Repeat daily, weekly, monthly or yearly.');
  }
  return value as RecurringFrequency;
}

export function normalizeInterval(value: unknown): number {
  const interval = value ?? 1;
  if (
    typeof interval !== 'number' ||
    !Number.isSafeInteger(interval) ||
    interval < 1 ||
    interval > MAX_RECURRENCE_INTERVAL
  ) {
    throw new ValidationError(`Repeat every 1 to ${MAX_RECURRENCE_INTERVAL} units.`);
  }
  return interval;
}

export function normalizeLocalDate(value: unknown, field: string): LocalDate {
  if (!isLocalDate(value)) {
    throw new ValidationError(`${field} must be a calendar date written YYYY-MM-DD.`);
  }
  return value;
}

/** Inclusive, and never before the start: a schedule that ends before it begins has no dates. */
export function normalizeEndDate(value: unknown, startDate: LocalDate): LocalDate | null {
  if (value === undefined || value === null) return null;
  const endDate = normalizeLocalDate(value, 'End date');
  if (endDate < startDate) {
    throw new ValidationError('End date cannot be before the start date.');
  }
  return endDate;
}

export function normalizeTitle(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError('Title must be text.');
  return value.trim();
}

export function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError('Note must be text.');
  return value.trim() || null;
}

export function normalizePaymentMode(value: unknown): PaymentMode | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !PAYMENT_MODES.includes(value as PaymentMode)) {
    throw new ValidationError('Payment mode is invalid.');
  }
  return value as PaymentMode;
}

/** The parts of an account and category that decide whether a template can generate. */
export type GenerationAccount = {
  currency: string;
  isArchived: boolean;
  deletedAt: Date | null;
} | null;

export type GenerationCategory = { type: string; deletedAt: Date | null } | null;

/**
 * Whether a template can produce a transaction right now, and if not, why.
 *
 * The same rules a person meets entering the transaction by hand: an archived
 * or deleted account is refused, a deleted category is refused, a category must
 * match the template's type, and the account's currency must still be the one
 * the template was written in. Checked in that order, so the reason reported is
 * the first thing somebody would have to fix.
 */
export function evaluateGenerationBlock(
  template: { type: RecurringTransactionType; currency: string },
  account: GenerationAccount,
  category: GenerationCategory,
): RecurringBlockedReason | null {
  if (account === null || account.deletedAt !== null) return 'account_deleted';
  if (account.isArchived) return 'account_archived';
  if (category === null || category.deletedAt !== null) return 'category_deleted';
  if (category.type !== template.type) return 'category_type_mismatch';
  if (account.currency !== template.currency) return 'currency_mismatch';
  return null;
}

/** The sentence for each blocked reason. Factual, and naming what would have to change. */
export function describeBlockedReason(reason: RecurringBlockedReason): string {
  switch (reason) {
    case 'account_archived':
      return 'This template’s account is archived. Unarchive it or choose another account.';
    case 'account_deleted':
      return 'This template’s account no longer exists. Choose another account.';
    case 'category_deleted':
      return 'This template’s category no longer exists. Choose another category.';
    case 'category_type_mismatch':
      return 'This template’s category does not match its type. Choose another category.';
    case 'currency_mismatch':
      return 'This template’s account now uses a different currency. Update the template.';
  }
}
