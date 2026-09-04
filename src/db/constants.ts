export const ACCOUNT_TYPES = ['cash', 'bank', 'wallet', 'credit_card', 'other'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = [
  'income',
  'expense',
  'transfer',
  'lend',
  'borrow',
  'repayment_received',
  'repayment_paid',
  'investment',
  'investment_return',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_MODES = [
  'cash',
  'debit_card',
  'credit_card',
  'bank_transfer',
  'qr',
  'digital_wallet',
  'cheque',
  'other',
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const CATEGORY_TYPES = ['income', 'expense'] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const DEFAULT_CURRENCY = 'NPR' as const;
