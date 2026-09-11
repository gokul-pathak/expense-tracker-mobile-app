import { z } from 'zod';

import {
  ACCOUNT_TYPES,
  CATEGORY_TYPES,
  MAX_RECURRENCE_INTERVAL,
  PAYMENT_MODES,
  PERIOD_MONTH_PATTERN,
  RECURRING_FREQUENCIES,
  RECURRING_OCCURRENCE_STATUSES,
  RECURRING_TRANSACTION_TYPES,
  TRANSACTION_TYPES,
} from '@/db/constants';
import { SYNC_ID_PATTERN, type SyncEntityType } from '@/db/schema';
import { isLocalDate } from '@/features/recurring/recurring-schedule';

/**
 * The cloud row contracts from `supabase/migrations/20260907000000_cloud_sync.sql`.
 *
 * Every mapped row is validated against these before it leaves the device, so a
 * malformed local record fails locally instead of being rejected by a remote
 * constraint. Money and timestamps are integers: minor currency units and epoch
 * milliseconds, matching the cloud `bigint` columns.
 */

/**
 * Shared primitives. Pull decoders reuse these so one contract describes the
 * cloud in both directions.
 */
export const syncIdSchema = z.string().regex(SYNC_ID_PATTERN);
export const userIdSchema = z.string().min(1);
// PostgreSQL bigint can hold more than JavaScript can represent exactly.
export const safeIntegerSchema = z.number().int().safe();
export const currencySchema = z.string().regex(/^[A-Z]{3,16}$/);
// A budget's month is calendar text, never an instant.
export const periodMonthSchema = z.string().regex(PERIOD_MONTH_PATTERN);
// So is a scheduled date, and it has to be a day that exists: 2026-02-30 is refused.
export const localDateSchema = z.string().refine(isLocalDate, 'must be a YYYY-MM-DD calendar date');
export const intervalSchema = z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL);

const syncId = syncIdSchema;
const userId = userIdSchema;
const safeInteger = safeIntegerSchema;
const timestamp = safeInteger.nonnegative();
const nullableTimestamp = timestamp.nullable();
const currency = currencySchema;
const nullableText = z.string().nullable();

export const remoteAccountSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    name: z.string().min(1),
    type: z.enum(ACCOUNT_TYPES),
    opening_balance_minor: safeInteger,
    currency,
    icon: nullableText,
    is_archived: z.boolean(),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export const remoteCategorySchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    name: z.string().min(1),
    type: z.enum(CATEGORY_TYPES),
    icon: nullableText,
    system_key: nullableText,
    is_default: z.boolean(),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export const remotePersonSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    name: z.string().min(1),
    note: nullableText,
    is_archived: z.boolean(),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export const remoteSettingsSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    default_currency: currency,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export const remoteBudgetSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    // Null is the overall monthly budget.
    category_sync_id: syncId.nullable(),
    period_month: periodMonthSchema,
    amount_minor: safeInteger.positive(),
    currency,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export const remoteTransactionSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    type: z.enum(TRANSACTION_TYPES),
    amount_minor: safeInteger.positive(),
    currency,
    category_sync_id: syncId.nullable(),
    source_account_sync_id: syncId.nullable(),
    destination_account_sync_id: syncId.nullable(),
    person_sync_id: syncId.nullable(),
    payment_mode: z.enum(PAYMENT_MODES).nullable(),
    transaction_date: timestamp,
    title: z.string(),
    note: nullableText,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
    // Null for every transaction a person entered; the occurrence for a generated one.
    recurring_occurrence_sync_id: syncId.nullable(),
  })
  .strict();

/**
 * A recurring template: a plan, never a figure. Nothing about it is financial
 * until an occurrence is generated, and then it is the transaction that travels.
 */
export const remoteRecurringTemplateSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    type: z.enum(RECURRING_TRANSACTION_TYPES),
    amount_minor: safeInteger.positive(),
    currency,
    category_sync_id: syncId,
    account_sync_id: syncId,
    payment_mode: z.enum(PAYMENT_MODES).nullable(),
    title: z.string(),
    note: nullableText,
    start_date: localDateSchema,
    frequency: z.enum(RECURRING_FREQUENCIES),
    interval_count: intervalSchema,
    end_date: localDateSchema.nullable(),
    is_paused: z.boolean(),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

/** A decision about one scheduled date. Its identity is derived, never random. */
export const remoteRecurringOccurrenceSchema = z
  .object({
    sync_id: syncId,
    user_id: userId,
    template_sync_id: syncId,
    occurrence_date: localDateSchema,
    status: z.enum(RECURRING_OCCURRENCE_STATUSES),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: nullableTimestamp,
  })
  .strict();

export type RemoteAccountRow = z.infer<typeof remoteAccountSchema>;
export type RemoteCategoryRow = z.infer<typeof remoteCategorySchema>;
export type RemotePersonRow = z.infer<typeof remotePersonSchema>;
export type RemoteSettingsRow = z.infer<typeof remoteSettingsSchema>;
export type RemoteBudgetRow = z.infer<typeof remoteBudgetSchema>;
export type RemoteTransactionRow = z.infer<typeof remoteTransactionSchema>;
export type RemoteRecurringTemplateRow = z.infer<typeof remoteRecurringTemplateSchema>;
export type RemoteRecurringOccurrenceRow = z.infer<typeof remoteRecurringOccurrenceSchema>;

export type RemoteRow =
  | RemoteAccountRow
  | RemoteBudgetRow
  | RemoteCategoryRow
  | RemotePersonRow
  | RemoteSettingsRow
  | RemoteTransactionRow
  | RemoteRecurringTemplateRow
  | RemoteRecurringOccurrenceRow;

/** Cloud table name and idempotency key for each local entity type. */
export const REMOTE_TABLES = {
  account: { table: 'accounts', onConflict: 'sync_id' },
  category: { table: 'categories', onConflict: 'sync_id' },
  person: { table: 'people', onConflict: 'sync_id' },
  // Settings is one row per user in the cloud, so ownership is its identity.
  settings: { table: 'settings', onConflict: 'user_id' },
  transaction: { table: 'transactions', onConflict: 'sync_id' },
  budget: { table: 'budgets', onConflict: 'sync_id' },
  recurring_template: { table: 'recurring_templates', onConflict: 'sync_id' },
  recurring_occurrence: { table: 'recurring_occurrences', onConflict: 'sync_id' },
} as const satisfies Record<SyncEntityType, { table: string; onConflict: string }>;

export const REMOTE_SCHEMA = 'sync' as const;

const schemasByEntity = {
  account: remoteAccountSchema,
  category: remoteCategorySchema,
  person: remotePersonSchema,
  settings: remoteSettingsSchema,
  transaction: remoteTransactionSchema,
  budget: remoteBudgetSchema,
  recurring_template: remoteRecurringTemplateSchema,
  recurring_occurrence: remoteRecurringOccurrenceSchema,
} as const;

/** Validates one mapped row. Returns an issue path only, never the row values. */
export function validateRemoteRow(
  entityType: SyncEntityType,
  row: unknown,
): { ok: true; row: RemoteRow } | { ok: false; issue: string } {
  const parsed = schemasByEntity[entityType].safeParse(row);
  if (parsed.success) return { ok: true, row: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, issue: first === undefined ? 'unknown' : first.path.join('.') || 'row' };
}
