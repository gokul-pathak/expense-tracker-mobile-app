import { INVESTMENT_ASSET_TYPES, type InvestmentAssetType } from '@/db/constants';
import { isLocalDate } from '@/features/recurring/recurring-schedule';
import { ValidationError } from '@/features/shared/errors';

/**
 * Normalising what a person typed into what is stored.
 *
 * Every rule here is a rule the cloud contract and the backup format repeat, so
 * nothing this accepts can be refused later on its way somewhere else.
 */

export const ASSET_NAME_MAX = 80;
export const ASSET_SYMBOL_MAX = 20;

const CURRENCY = /^[A-Z]{3,16}$/;

export function normalizeAssetName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('Asset name is required.');
  }
  const name = value.trim();
  if (name.length > ASSET_NAME_MAX) {
    throw new ValidationError(`Asset name must be at most ${ASSET_NAME_MAX} characters.`);
  }
  return name;
}

/** Optional: plenty of what people own has no ticker. Stored uppercase. */
export function normalizeAssetSymbol(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError('Symbol must be text.');
  const symbol = value.trim().toUpperCase();
  if (symbol === '') return null;
  if (symbol.length > ASSET_SYMBOL_MAX) {
    throw new ValidationError(`Symbol must be at most ${ASSET_SYMBOL_MAX} characters.`);
  }
  return symbol;
}

export function normalizeAssetType(value: unknown): InvestmentAssetType {
  if (typeof value !== 'string' || !INVESTMENT_ASSET_TYPES.includes(value as InvestmentAssetType)) {
    throw new ValidationError('Asset type is invalid.');
  }
  return value as InvestmentAssetType;
}

export function normalizeInvestmentCurrency(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('Currency is required.');
  const currency = value.trim().toUpperCase();
  if (!CURRENCY.test(currency)) throw new ValidationError('Currency must be a currency code.');
  return currency;
}

/** Integer quantity minor units, above zero. See `parseQuantity` for typed text. */
export function normalizeQuantityMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Quantity must be a positive whole number of quantity units.');
  }
  return value;
}

export function normalizePositiveMinor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer number of minor units.`);
  }
  return value;
}

/** A missing fee is no fee. */
export function normalizeFeeMinor(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('Fee must be zero or a positive integer number of minor units.');
  }
  return value;
}

export function normalizeTradeDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Trade date must be a valid date.');
  }
  return value;
}

/** A price is for a calendar day, `YYYY-MM-DD`, never an instant. */
export function normalizePriceDate(value: unknown): string {
  if (typeof value !== 'string' || !isLocalDate(value)) {
    throw new ValidationError('Price date must be a YYYY-MM-DD calendar date.');
  }
  return value;
}

export function normalizeOptionalNote(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError('Note must be text.');
  return value.trim() || null;
}
