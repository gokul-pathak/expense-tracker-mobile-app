import { randomUUID } from 'node:crypto';

import type {
  AccountType,
  InvestmentAssetType,
  InvestmentTradeType,
  PaymentMode,
  RecurringFrequency,
  RecurringOccurrenceStatus,
  TransactionType,
} from '@/db/constants';
import { deriveOccurrenceSyncId } from '@/features/recurring/recurring-identity';

/**
 * Builders for rows another device would have written to the cloud.
 *
 * They produce exactly the shape `supabase/migrations/20260907000000_cloud_sync.sql`
 * defines, minus the two server-generated columns the fake cloud assigns itself.
 */

export const TEST_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function cloudSyncId(): string {
  return randomUUID();
}

type Timestamps = { created_at?: number; updated_at?: number; deleted_at?: number | null };

const DEFAULT_CREATED_AT = new Date(2026, 0, 1).getTime();
const DEFAULT_UPDATED_AT = new Date(2026, 0, 2).getTime();

function timestamps(overrides: Timestamps) {
  return {
    created_at: overrides.created_at ?? DEFAULT_CREATED_AT,
    updated_at: overrides.updated_at ?? DEFAULT_UPDATED_AT,
    deleted_at: overrides.deleted_at ?? null,
  };
}

export function cloudAccount(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    name: string;
    type: AccountType;
    opening_balance_minor: number | string;
    currency: string;
    icon: string | null;
    is_archived: boolean;
  }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    name: overrides.name ?? 'Cloud Cash',
    type: overrides.type ?? 'cash',
    opening_balance_minor: overrides.opening_balance_minor ?? 0,
    currency: overrides.currency ?? 'NPR',
    icon: overrides.icon ?? null,
    is_archived: overrides.is_archived ?? false,
    ...timestamps(overrides),
  };
}

export function cloudCategory(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    name: string;
    type: 'income' | 'expense';
    icon: string | null;
    system_key: string | null;
    is_default: boolean;
  }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    name: overrides.name ?? 'Cloud Coffee',
    type: overrides.type ?? 'expense',
    icon: overrides.icon ?? null,
    system_key: overrides.system_key ?? null,
    is_default: overrides.is_default ?? false,
    ...timestamps(overrides),
  };
}

export function cloudPerson(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    name: string;
    note: string | null;
    is_archived: boolean;
  }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    name: overrides.name ?? 'Ram',
    note: overrides.note ?? null,
    is_archived: overrides.is_archived ?? false,
    ...timestamps(overrides),
  };
}

export function cloudSettings(
  overrides: Partial<{ sync_id: string; user_id: string; default_currency: string }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    default_currency: overrides.default_currency ?? 'USD',
    ...timestamps(overrides),
  };
}

export function cloudTransaction(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    type: TransactionType;
    amount_minor: number | string;
    currency: string;
    category_sync_id: string | null;
    source_account_sync_id: string | null;
    destination_account_sync_id: string | null;
    person_sync_id: string | null;
    payment_mode: PaymentMode | null;
    transaction_date: number;
    title: string;
    note: string | null;
    recurring_occurrence_sync_id: string | null;
    investment_trade_sync_id: string | null;
  }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    type: overrides.type ?? 'expense',
    amount_minor: overrides.amount_minor ?? 5000,
    currency: overrides.currency ?? 'NPR',
    category_sync_id: overrides.category_sync_id ?? null,
    source_account_sync_id: overrides.source_account_sync_id ?? null,
    destination_account_sync_id: overrides.destination_account_sync_id ?? null,
    person_sync_id: overrides.person_sync_id ?? null,
    payment_mode: overrides.payment_mode ?? null,
    transaction_date: overrides.transaction_date ?? new Date(2026, 0, 15).getTime(),
    title: overrides.title ?? 'Cloud lunch',
    note: overrides.note ?? null,
    ...timestamps(overrides),
    recurring_occurrence_sync_id: overrides.recurring_occurrence_sync_id ?? null,
    investment_trade_sync_id: overrides.investment_trade_sync_id ?? null,
  };
}

export function cloudInvestmentAsset(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    name: string;
    symbol: string | null;
    asset_type: InvestmentAssetType;
    currency: string;
    is_archived: boolean;
  }> &
    Timestamps = {},
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    name: overrides.name ?? 'Cloud Shares',
    symbol: overrides.symbol ?? null,
    asset_type: overrides.asset_type ?? 'stock',
    currency: overrides.currency ?? 'NPR',
    is_archived: overrides.is_archived ?? false,
    ...timestamps(overrides),
  };
}

/** A buy of 10 units at 1,000.00 by default; a dividend or fee carries only an amount. */
export function cloudInvestmentTrade(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    trade_type: InvestmentTradeType;
    trade_date: number;
    quantity_minor: number | string | null;
    unit_price_minor: number | string | null;
    fee_minor: number | string;
    amount_minor: number | string | null;
    currency: string;
    note: string | null;
  }> &
    Timestamps & { asset_sync_id: string; account_sync_id: string },
) {
  const tradeType = overrides.trade_type ?? 'buy';
  const moves = tradeType === 'buy' || tradeType === 'sell';
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    asset_sync_id: overrides.asset_sync_id,
    account_sync_id: overrides.account_sync_id,
    trade_type: tradeType,
    trade_date: overrides.trade_date ?? new Date(2026, 0, 10).getTime(),
    quantity_minor:
      'quantity_minor' in overrides ? overrides.quantity_minor : moves ? 1_000_000_000 : null,
    unit_price_minor:
      'unit_price_minor' in overrides ? overrides.unit_price_minor : moves ? 100_000 : null,
    fee_minor: overrides.fee_minor ?? 0,
    amount_minor: 'amount_minor' in overrides ? overrides.amount_minor : moves ? null : 50_000,
    currency: overrides.currency ?? 'NPR',
    note: overrides.note ?? null,
    ...timestamps(overrides),
  };
}

export function cloudInvestmentPrice(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    price_minor: number | string;
    price_date: string;
    currency: string;
  }> &
    Timestamps & { asset_sync_id: string },
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    asset_sync_id: overrides.asset_sync_id,
    price_minor: overrides.price_minor ?? 120_000,
    price_date: overrides.price_date ?? '2026-01-15',
    currency: overrides.currency ?? 'NPR',
    ...timestamps(overrides),
  };
}

export function cloudRecurringTemplate(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    type: 'expense' | 'income';
    amount_minor: number | string;
    currency: string;
    category_sync_id: string;
    account_sync_id: string;
    payment_mode: PaymentMode | null;
    title: string;
    note: string | null;
    start_date: string;
    frequency: RecurringFrequency;
    interval_count: number;
    end_date: string | null;
    is_paused: boolean;
  }> &
    Timestamps & { category_sync_id: string; account_sync_id: string },
) {
  return {
    sync_id: overrides.sync_id ?? cloudSyncId(),
    user_id: overrides.user_id ?? TEST_USER,
    type: overrides.type ?? 'expense',
    amount_minor: overrides.amount_minor ?? 2_000_000,
    currency: overrides.currency ?? 'NPR',
    category_sync_id: overrides.category_sync_id,
    account_sync_id: overrides.account_sync_id,
    payment_mode: overrides.payment_mode ?? null,
    title: overrides.title ?? 'Rent',
    note: overrides.note ?? null,
    start_date: overrides.start_date ?? '2026-06-15',
    frequency: overrides.frequency ?? 'monthly',
    interval_count: overrides.interval_count ?? 1,
    end_date: overrides.end_date ?? null,
    is_paused: overrides.is_paused ?? false,
    ...timestamps(overrides),
  };
}

/** Its identity is derived from the template and date, as every device derives it. */
export function cloudRecurringOccurrence(
  overrides: Partial<{
    sync_id: string;
    user_id: string;
    status: RecurringOccurrenceStatus;
  }> &
    Timestamps & { template_sync_id: string; occurrence_date: string },
) {
  return {
    sync_id:
      overrides.sync_id ??
      deriveOccurrenceSyncId(overrides.template_sync_id, overrides.occurrence_date),
    user_id: overrides.user_id ?? TEST_USER,
    template_sync_id: overrides.template_sync_id,
    occurrence_date: overrides.occurrence_date,
    status: overrides.status ?? 'generated',
    ...timestamps(overrides),
  };
}
