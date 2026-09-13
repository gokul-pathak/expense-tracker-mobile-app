import { isIconName, type IconName } from '@/components/ui';
import type { PaymentMode } from '@/db/constants';
import { accountTypeIcon } from '@/theme';

/**
 * How entry forms name things.
 *
 * Shared by Add Expense and Review Receipt, so a payment mode, a date and an
 * account read identically whichever way an expense was entered. Two copies of
 * these would eventually disagree about something as small as "Debit Card".
 */

export const paymentModeLabels: Record<PaymentMode, string> = {
  cash: 'Cash',
  debit_card: 'Debit Card',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  qr: 'QR',
  digital_wallet: 'Digital Wallet',
  cheque: 'Cheque',
  other: 'Other',
};

/** Today and yesterday are named; anything else states its date. */
export function describeDate(date: Date): string {
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startValue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((startToday.getTime() - startValue.getTime()) / 86_400_000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function accountIcon(accountType: string): IconName {
  const key = accountTypeIcon[accountType];
  return isIconName(key) ? key : 'wallet';
}

export function accountTypeLabel(accountType: string): string {
  return accountType.replace('_', ' ');
}
