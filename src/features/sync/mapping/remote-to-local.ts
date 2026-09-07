import type {
  PulledAccountRow,
  PulledCategoryRow,
  PulledPersonRow,
  PulledSettingsRow,
  PulledTransactionRow,
} from '../remote/remote-pull-rows';
import type {
  RemoteAccount,
  RemoteCategory,
  RemotePerson,
  RemoteSettings,
  RemoteTransaction,
} from '../remote-apply.repository';

/**
 * Cloud row → local apply input.
 *
 * The mirror of `local-to-remote.ts`, with the same two rules:
 *
 * 1. Identity crossing the device boundary is always the global `sync_id`.
 *    Local integer keys are resolved later, from that identity.
 * 2. Domain history is preserved exactly. `created_at`, `updated_at` and
 *    `transaction_date` are the originating device's values, not this device's
 *    clock, so a record means the same thing everywhere.
 *
 * No derived figure is mapped, because none is transported: balances, savings,
 * receivables and report totals are recomputed locally from these source rows.
 */

export function mapPulledAccountToLocal(row: PulledAccountRow): RemoteAccount {
  return {
    syncId: row.sync_id,
    name: row.name,
    type: row.type,
    openingBalanceMinor: row.opening_balance_minor,
    currency: row.currency,
    icon: row.icon,
    isArchived: row.is_archived,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

export function mapPulledCategoryToLocal(row: PulledCategoryRow): RemoteCategory {
  return {
    syncId: row.sync_id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    // Built-in identity, so a downloaded default reconciles with a seeded one
    // instead of duplicating it.
    systemKey: row.system_key,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

export function mapPulledPersonToLocal(row: PulledPersonRow): RemotePerson {
  return {
    syncId: row.sync_id,
    name: row.name,
    note: row.note,
    isArchived: row.is_archived,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

export function mapPulledSettingsToLocal(row: PulledSettingsRow): RemoteSettings {
  return {
    syncId: row.sync_id,
    defaultCurrency: row.default_currency,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

export function mapPulledTransactionToLocal(row: PulledTransactionRow): RemoteTransaction {
  return {
    syncId: row.sync_id,
    // Every domain type keeps its own meaning: a transfer arrives as one
    // transfer, and a debt type is never rewritten as income or expense.
    type: row.type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    categorySyncId: row.category_sync_id,
    sourceAccountSyncId: row.source_account_sync_id,
    destinationAccountSyncId: row.destination_account_sync_id,
    personSyncId: row.person_sync_id,
    paymentMode: row.payment_mode,
    // The financial date is independent of when the row was written or synced.
    transactionDate: new Date(row.transaction_date),
    title: row.title,
    note: row.note,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

function toNullableDate(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}
