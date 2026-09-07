import { randomUUID } from 'node:crypto';

import type { AccountType, PaymentMode, TransactionType } from '@/db/constants';

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
  };
}
