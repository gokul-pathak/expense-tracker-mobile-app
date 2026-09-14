import type { Account } from '@/db/schema/accounts';
import type { Budget } from '@/db/schema/budgets';
import type { Category } from '@/db/schema/categories';
import type { InvestmentAsset, InvestmentPrice, InvestmentTrade } from '@/db/schema/investments';
import type { Person } from '@/db/schema/people';
import type { RecurringOccurrence, RecurringTemplate } from '@/db/schema/recurring';
import type { Setting } from '@/db/schema/settings';
import type { Transaction } from '@/db/schema/transactions';

import type {
  RemoteAccountRow,
  RemoteBudgetRow,
  RemoteCategoryRow,
  RemoteInvestmentAssetRow,
  RemoteInvestmentPriceRow,
  RemoteInvestmentTradeRow,
  RemotePersonRow,
  RemoteRecurringOccurrenceRow,
  RemoteRecurringTemplateRow,
  RemoteSettingsRow,
  RemoteTransactionRow,
} from '../remote/remote-rows';

/**
 * Local row → cloud row.
 *
 * Two rules hold everywhere here:
 *
 * 1. Ownership comes from the trusted sync context, never from local data. The
 *    caller passes the authenticated and linked user id.
 * 2. Identity crossing the device boundary is always the global `syncId`.
 *    Local integer primary keys and foreign keys never leave the device.
 *
 * Derived figures — balances, savings, receivables, report totals — are
 * recomputed from source rows and are deliberately absent from every mapping.
 */

export type MappingContext = {
  userId: string;
};

/** Resolves a local foreign key to the referenced row's global identity. */
export type RelationResolver = {
  account: (localId: number) => string | undefined;
  category: (localId: number) => string | undefined;
  person: (localId: number) => string | undefined;
  recurringTemplate: (localId: number) => string | undefined;
  recurringOccurrence: (localId: number) => string | undefined;
  investmentAsset: (localId: number) => string | undefined;
  investmentTrade: (localId: number) => string | undefined;
};

export class MappingError extends Error {
  constructor(readonly reason: string) {
    super(`Local record cannot be mapped for upload: ${reason}`);
    this.name = 'MappingError';
  }
}

export function mapLocalAccountToRemote(
  account: Account,
  context: MappingContext,
): RemoteAccountRow {
  return {
    sync_id: requireSyncId(account.syncId, 'account'),
    user_id: context.userId,
    name: account.name,
    type: account.type,
    opening_balance_minor: account.openingBalanceMinor,
    currency: account.currency,
    icon: account.icon,
    is_archived: account.isArchived,
    created_at: toEpochMs(account.createdAt, 'account.createdAt'),
    updated_at: toEpochMs(account.updatedAt, 'account.updatedAt'),
    deleted_at: toNullableEpochMs(account.deletedAt),
  };
}

/**
 * A budget crosses the boundary as a plan, never as a figure.
 *
 * Only the month, the amount and what it applies to travel. What was spent is
 * absent because it is not stored: every device recomputes it from the
 * transactions it holds, so two devices with the same records always agree
 * without a derived number ever being transported.
 */
export function mapLocalBudgetToRemote(
  budget: Budget,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteBudgetRow {
  return {
    sync_id: requireSyncId(budget.syncId, 'budget'),
    user_id: context.userId,
    // Null is the overall monthly budget.
    category_sync_id: resolveRelation(resolve.category, budget.categoryId, 'category'),
    period_month: budget.periodMonth,
    amount_minor: budget.amountMinor,
    currency: budget.currency,
    created_at: toEpochMs(budget.createdAt, 'budget.createdAt'),
    updated_at: toEpochMs(budget.updatedAt, 'budget.updatedAt'),
    deleted_at: toNullableEpochMs(budget.deletedAt),
  };
}

export function mapLocalCategoryToRemote(
  category: Category,
  context: MappingContext,
): RemoteCategoryRow {
  return {
    sync_id: requireSyncId(category.syncId, 'category'),
    user_id: context.userId,
    name: category.name,
    type: category.type,
    icon: category.icon,
    // Built-in identity travels with the row so a second device reconciles it.
    system_key: category.systemKey,
    is_default: category.isDefault,
    created_at: toEpochMs(category.createdAt, 'category.createdAt'),
    updated_at: toEpochMs(category.updatedAt, 'category.updatedAt'),
    deleted_at: toNullableEpochMs(category.deletedAt),
  };
}

export function mapLocalPersonToRemote(person: Person, context: MappingContext): RemotePersonRow {
  return {
    sync_id: requireSyncId(person.syncId, 'person'),
    user_id: context.userId,
    name: person.name,
    note: person.note,
    is_archived: person.isArchived,
    created_at: toEpochMs(person.createdAt, 'person.createdAt'),
    updated_at: toEpochMs(person.updatedAt, 'person.updatedAt'),
    deleted_at: toNullableEpochMs(person.deletedAt),
  };
}

export function mapLocalSettingsToRemote(
  setting: Setting,
  context: MappingContext,
): RemoteSettingsRow {
  return {
    sync_id: requireSyncId(setting.syncId, 'settings record'),
    user_id: context.userId,
    default_currency: setting.defaultCurrency,
    created_at: toEpochMs(setting.createdAt, 'settings.createdAt'),
    updated_at: toEpochMs(setting.updatedAt, 'settings.updatedAt'),
    deleted_at: toNullableEpochMs(setting.deletedAt),
  };
}

export function mapLocalTransactionToRemote(
  transaction: Transaction,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteTransactionRow {
  return {
    sync_id: requireSyncId(transaction.syncId, 'transaction'),
    user_id: context.userId,
    // Every domain type keeps its own meaning: a transfer stays one transfer,
    // and debt types are never rewritten as income or expense.
    type: transaction.type,
    amount_minor: transaction.amountMinor,
    currency: transaction.currency,
    category_sync_id: resolveRelation(resolve.category, transaction.categoryId, 'category'),
    source_account_sync_id: resolveRelation(
      resolve.account,
      transaction.sourceAccountId,
      'source account',
    ),
    destination_account_sync_id: resolveRelation(
      resolve.account,
      transaction.destinationAccountId,
      'destination account',
    ),
    person_sync_id: resolveRelation(resolve.person, transaction.personId, 'person'),
    payment_mode: transaction.paymentMode,
    // The financial date is independent of when the row was written or synced.
    transaction_date: toEpochMs(transaction.transactionDate, 'transaction.transactionDate'),
    title: transaction.title,
    note: transaction.note,
    created_at: toEpochMs(transaction.createdAt, 'transaction.createdAt'),
    updated_at: toEpochMs(transaction.updatedAt, 'transaction.updatedAt'),
    deleted_at: toNullableEpochMs(transaction.deletedAt),
    // Provenance for a generated transaction, null for everything else.
    recurring_occurrence_sync_id: resolveRelation(
      resolve.recurringOccurrence,
      transaction.recurringOccurrenceId,
      'recurring occurrence',
    ),
    // The trade whose cash this is, null for everything else.
    investment_trade_sync_id: resolveRelation(
      resolve.investmentTrade,
      transaction.investmentTradeId,
      'investment trade',
    ),
  };
}

/** An asset travels as a description. What is held and what it is worth are derived. */
export function mapLocalInvestmentAssetToRemote(
  asset: InvestmentAsset,
  context: MappingContext,
): RemoteInvestmentAssetRow {
  return {
    sync_id: requireSyncId(asset.syncId, 'investment asset'),
    user_id: context.userId,
    name: asset.name,
    symbol: asset.symbol,
    asset_type: asset.assetType,
    currency: asset.currency,
    is_archived: asset.isArchived,
    created_at: toEpochMs(asset.createdAt, 'investmentAsset.createdAt'),
    updated_at: toEpochMs(asset.updatedAt, 'investmentAsset.updatedAt'),
    deleted_at: toNullableEpochMs(asset.deletedAt),
  };
}

/**
 * A trade travels with the three fields its place in history is decided by —
 * `trade_date`, `created_at` and its identity — so every device replays it in
 * the same position. Holding, cost basis and gain never travel.
 */
export function mapLocalInvestmentTradeToRemote(
  trade: InvestmentTrade,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteInvestmentTradeRow {
  return {
    sync_id: requireSyncId(trade.syncId, 'investment trade'),
    user_id: context.userId,
    asset_sync_id: requireRelation(resolve.investmentAsset, trade.assetId, 'investment asset'),
    account_sync_id: requireRelation(resolve.account, trade.accountId, 'account'),
    trade_type: trade.tradeType,
    trade_date: toEpochMs(trade.tradeDate, 'investmentTrade.tradeDate'),
    quantity_minor: trade.quantityMinor,
    unit_price_minor: trade.unitPriceMinor,
    fee_minor: trade.feeMinor,
    amount_minor: trade.amountMinor,
    currency: trade.currency,
    note: trade.note,
    created_at: toEpochMs(trade.createdAt, 'investmentTrade.createdAt'),
    updated_at: toEpochMs(trade.updatedAt, 'investmentTrade.updatedAt'),
    deleted_at: toNullableEpochMs(trade.deletedAt),
  };
}

export function mapLocalInvestmentPriceToRemote(
  price: InvestmentPrice,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteInvestmentPriceRow {
  return {
    sync_id: requireSyncId(price.syncId, 'investment price'),
    user_id: context.userId,
    asset_sync_id: requireRelation(resolve.investmentAsset, price.assetId, 'investment asset'),
    price_minor: price.priceMinor,
    price_date: price.priceDate,
    currency: price.currency,
    created_at: toEpochMs(price.createdAt, 'investmentPrice.createdAt'),
    updated_at: toEpochMs(price.updatedAt, 'investmentPrice.updatedAt'),
    deleted_at: toNullableEpochMs(price.deletedAt),
  };
}

/**
 * A template crosses the boundary as a plan. Its schedule travels as calendar
 * dates, never instants, so "the 1st" means the 1st on every device. What is
 * due is absent because it is not stored: each device derives it from the
 * schedule and the occurrences it holds.
 */
export function mapLocalRecurringTemplateToRemote(
  template: RecurringTemplate,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteRecurringTemplateRow {
  return {
    sync_id: requireSyncId(template.syncId, 'recurring template'),
    user_id: context.userId,
    type: template.type,
    amount_minor: template.amountMinor,
    currency: template.currency,
    category_sync_id: requireRelation(resolve.category, template.categoryId, 'category'),
    account_sync_id: requireRelation(resolve.account, template.accountId, 'account'),
    payment_mode: template.paymentMode,
    title: template.title,
    note: template.note,
    start_date: template.startDate,
    frequency: template.frequency,
    interval_count: template.interval,
    end_date: template.endDate,
    is_paused: template.isPaused,
    created_at: toEpochMs(template.createdAt, 'recurringTemplate.createdAt'),
    updated_at: toEpochMs(template.updatedAt, 'recurringTemplate.updatedAt'),
    deleted_at: toNullableEpochMs(template.deletedAt),
  };
}

/** A decision about one date. Its identity is derived from the template and the date. */
export function mapLocalRecurringOccurrenceToRemote(
  occurrence: RecurringOccurrence,
  context: MappingContext,
  resolve: RelationResolver,
): RemoteRecurringOccurrenceRow {
  return {
    sync_id: requireSyncId(occurrence.syncId, 'recurring occurrence'),
    user_id: context.userId,
    template_sync_id: requireRelation(
      resolve.recurringTemplate,
      occurrence.templateId,
      'recurring template',
    ),
    occurrence_date: occurrence.occurrenceDate,
    status: occurrence.status,
    created_at: toEpochMs(occurrence.createdAt, 'recurringOccurrence.createdAt'),
    updated_at: toEpochMs(occurrence.updatedAt, 'recurringOccurrence.updatedAt'),
    deleted_at: toNullableEpochMs(occurrence.deletedAt),
  };
}

function resolveRelation(
  lookup: (localId: number) => string | undefined,
  localId: number | null,
  label: string,
): string | null {
  if (localId === null) return null;
  const syncId = lookup(localId);
  if (syncId === undefined) {
    throw new MappingError(`referenced ${label} has no sync identity`);
  }
  return syncId;
}

/** A relation the row cannot exist without. */
function requireRelation(
  lookup: (localId: number) => string | undefined,
  localId: number,
  label: string,
): string {
  const syncId = lookup(localId);
  if (syncId === undefined) throw new MappingError(`referenced ${label} has no sync identity`);
  return syncId;
}

function requireSyncId(value: string | null, label: string): string {
  if (value === null) throw new MappingError(`${label} has no sync identity`);
  return value;
}

function toEpochMs(value: Date, label: string): number {
  const epochMs = value.getTime();
  if (!Number.isSafeInteger(epochMs)) throw new MappingError(`${label} is not a valid timestamp`);
  return epochMs;
}

function toNullableEpochMs(value: Date | null): number | null {
  return value === null ? null : toEpochMs(value, 'deletedAt');
}
