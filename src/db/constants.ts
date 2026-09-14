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

/**
 * A budget's month, `YYYY-MM`.
 *
 * A month is an identity rather than an instant: storing a timestamp would make
 * two devices in different time zones disagree about which month a budget
 * belongs to. The schema, the cloud contracts and the backup format all check
 * against this one pattern.
 */
export const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The transaction types a recurring template may produce.
 *
 * Only the two whose effect is fully described by one row: money in, or money
 * out, against one account and one category. A recurring transfer, loan or
 * repayment would need the debt and transfer invariants re-checked at every
 * generation, and a skipped repayment has no obvious meaning. Those stay manual.
 */
export const RECURRING_TRANSACTION_TYPES = ['expense', 'income'] as const;

export type RecurringTransactionType = (typeof RECURRING_TRANSACTION_TYPES)[number];

/** Calendar-based repetition only. No RRULE, no weekday sets, no business days. */
export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/**
 * What happened to one scheduled date. There is deliberately no `pending` or
 * `failed`: a date nobody has handled yet is derived from the schedule, never
 * stored, so the table holds only decisions a person actually made.
 */
export const RECURRING_OCCURRENCE_STATUSES = ['generated', 'skipped'] as const;

export type RecurringOccurrenceStatus = (typeof RECURRING_OCCURRENCE_STATUSES)[number];

/**
 * The largest repeat interval: "every 999 days". The bound exists so a typo
 * cannot schedule a date past the four-digit years every date here is written
 * in, not because any particular large interval is wrong.
 */
export const MAX_RECURRENCE_INTERVAL = 999;

/**
 * A calendar date, `YYYY-MM-DD`.
 *
 * Like a budget month, a scheduled date is an identity rather than an instant.
 * "Rent on the 1st" is the 1st on every device, whatever its time zone, and an
 * instant would make two devices disagree about which day it is. This checks
 * the shape; whether the day exists in its month is checked by the schedule.
 */
export const LOCAL_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Where a receipt has got to.
 *
 * `failed` is a state of its own rather than an empty draft: a receipt that
 * could not be read must never look like an expense of zero.
 */
export const RECEIPT_PROCESSING_STATUSES = [
  'captured',
  'processing',
  'ready_for_review',
  'failed',
] as const;

export type ReceiptProcessingStatusName = (typeof RECEIPT_PROCESSING_STATUSES)[number];

/**
 * What an investment asset is. Deliberately modest, and descriptive only: no
 * calculation branches on it. There are no options, futures or other
 * derivatives, and no type that could be shorted.
 */
export const INVESTMENT_ASSET_TYPES = [
  'stock',
  'mutual_fund',
  'etf',
  'bond',
  'crypto',
  'fixed_deposit',
  'other',
] as const;

export type InvestmentAssetType = (typeof INVESTMENT_ASSET_TYPES)[number];

/**
 * What happened to an asset. A buy and a sell move quantity and cash; a dividend
 * moves cash in; a standalone fee moves cash out. Every one of them writes one
 * linked cash transaction — see `docs/investments-m10a.md`.
 */
export const INVESTMENT_TRADE_TYPES = ['buy', 'sell', 'dividend', 'fee'] as const;

export type InvestmentTradeType = (typeof INVESTMENT_TRADE_TYPES)[number];

/**
 * Decimal places of one unit that a quantity is stored to.
 *
 * Quantities are integers of 10^-8 of a unit — 1.23456789 shares is 123,456,789
 * — never `REAL`. Eight places covers fractional shares, mutual fund units and
 * the smallest unit of the common cryptocurrencies. It is part of the stored data
 * format, like a column name: changing it means rewriting every quantity.
 */
export const INVESTMENT_QUANTITY_SCALE = 8;
