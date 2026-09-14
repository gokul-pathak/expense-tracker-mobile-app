/**
 * The title each trade's linked cash transaction is stored with.
 *
 * Deliberately generic: renaming an asset must not leave stale titles on its cash.
 * Kept in a module with no imports, because the transaction list reads it to name
 * investment cash and that list renders in bundles where the database never opens.
 */
export const INVESTMENT_CASH_TITLES = {
  buy: 'Investment Purchase',
  sell: 'Investment Sale',
  dividend: 'Dividend',
  fee: 'Investment Fee',
} as const;
