import { sql } from 'drizzle-orm';
import { check, index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_TRADE_TYPES,
  type InvestmentAssetType,
  type InvestmentTradeType,
} from '../constants';

import { accounts } from './accounts';

const assetTypeList = INVESTMENT_ASSET_TYPES.map((value) => `'${value}'`).join(', ');
const tradeTypeList = INVESTMENT_TRADE_TYPES.map((value) => `'${value}'`).join(', ');
const LOCAL_DATE_GLOB = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

/**
 * Something a person owns: shares, a fund, a bond, a deposit.
 *
 * An asset holds no figures at all. How many units are held, what they cost and
 * what they are worth are derived from its trades and prices every time — see
 * `features/investments/investment-replay.ts`. `symbol` is optional because
 * plenty of what people own has no ticker.
 *
 * `currency` is the currency every trade and price of the asset is in. Nothing
 * converts: a trade is refused unless its account holds the same currency.
 */
export const investmentAssets = sqliteTable(
  'investment_assets',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    symbol: text('symbol'),
    assetType: text('asset_type').notNull().$type<InvestmentAssetType>(),
    currency: text('currency').notNull(),
    isArchived: int('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('valid_investment_asset_type', sql`\`asset_type\` IN (${sql.raw(assetTypeList)})`),
    uniqueIndex('uq_investment_assets_sync_id').on(t.syncId),
  ],
);

/**
 * One event in an asset's history, and the source of truth for its quantity,
 * cost basis and gains.
 *
 * A buy or sell carries a quantity (integer units of 10^-8, see
 * `INVESTMENT_QUANTITY_SCALE`), a price per whole unit and a fee. A dividend or a
 * standalone fee carries only an amount. The check constraint holds both shapes,
 * so a sell without a quantity cannot be stored.
 *
 * Its cash effect is not here. Each trade has exactly one linked transaction —
 * `transactions.investment_trade_id` — and account balances read only that, so
 * the cash moves once. `accountId` and `currency` repeat what the transaction
 * says, so a trade can be validated and replayed without joining to it.
 */
export const investmentTrades = sqliteTable(
  'investment_trades',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    assetId: int('asset_id')
      .notNull()
      .references(() => investmentAssets.id),
    accountId: int('account_id')
      .notNull()
      .references(() => accounts.id),
    tradeType: text('trade_type').notNull().$type<InvestmentTradeType>(),
    tradeDate: int('trade_date', { mode: 'timestamp_ms' }).notNull(),
    quantityMinor: int('quantity_minor'),
    unitPriceMinor: int('unit_price_minor'),
    feeMinor: int('fee_minor').notNull().default(0),
    amountMinor: int('amount_minor'),
    currency: text('currency').notNull(),
    note: text('note'),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('valid_investment_trade_type', sql`\`trade_type\` IN (${sql.raw(tradeTypeList)})`),
    check(
      'investment_trade_shape',
      sql`(\`trade_type\` IN ('buy', 'sell') AND \`quantity_minor\` > 0 AND \`unit_price_minor\` > 0 AND \`fee_minor\` >= 0 AND \`amount_minor\` IS NULL) OR (\`trade_type\` IN ('dividend', 'fee') AND \`quantity_minor\` IS NULL AND \`unit_price_minor\` IS NULL AND \`fee_minor\` = 0 AND \`amount_minor\` > 0)`,
    ),
    uniqueIndex('uq_investment_trades_sync_id').on(t.syncId),
    // Replay order within an asset.
    index('idx_investment_trades_asset_order').on(t.assetId, t.tradeDate, t.createdAt),
    index('idx_investment_trades_account').on(t.accountId),
  ],
);

/**
 * A price someone entered by hand, for one asset on one calendar day.
 *
 * There is no market feed. The latest price on or before a day is the one a
 * valuation uses, and an asset with no price at all has an unknown value — never
 * zero, and never quietly its last purchase price.
 */
export const investmentPrices = sqliteTable(
  'investment_prices',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    assetId: int('asset_id')
      .notNull()
      .references(() => investmentAssets.id),
    priceMinor: int('price_minor').notNull(),
    priceDate: text('price_date').notNull(),
    currency: text('currency').notNull(),
    createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
    syncId: text('sync_id'),
    deletedAt: int('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('investment_price_positive', sql`\`price_minor\` > 0`),
    check('valid_investment_price_date', sql`\`price_date\` GLOB ${sql.raw(LOCAL_DATE_GLOB)}`),
    uniqueIndex('uq_investment_prices_sync_id').on(t.syncId),
    index('idx_investment_prices_asset_date').on(t.assetId, t.priceDate),
  ],
);

export type InvestmentAsset = typeof investmentAssets.$inferSelect;
export type NewInvestmentAsset = typeof investmentAssets.$inferInsert;
export type InvestmentTrade = typeof investmentTrades.$inferSelect;
export type NewInvestmentTrade = typeof investmentTrades.$inferInsert;
export type InvestmentPrice = typeof investmentPrices.$inferSelect;
export type NewInvestmentPrice = typeof investmentPrices.$inferInsert;
