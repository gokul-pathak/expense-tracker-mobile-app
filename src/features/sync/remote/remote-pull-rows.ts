import { z } from 'zod';

import { ACCOUNT_TYPES, CATEGORY_TYPES, PAYMENT_MODES, TRANSACTION_TYPES } from '@/db/constants';
import { SYNC_ENTITY_TYPES, type SyncEntityType } from '@/db/schema';

import { currencySchema, syncIdSchema, userIdSchema, REMOTE_TABLES } from './remote-rows';

/**
 * Downloaded cloud rows.
 *
 * Row level security already restricts what a query can return, but a
 * downloaded row is still untrusted input: it crossed a network, it was written
 * by another build of this app, and it is about to change financial records. It
 * must be decoded before anything reads a field off it.
 *
 * These reuse the push contracts' primitives and add the two server-generated
 * columns pull depends on, `server_revision` and `server_updated_at`.
 */

/**
 * PostgreSQL `bigint` does not fit in a JavaScript number, and PostgREST may
 * send it either as a JSON number or as a string depending on configuration.
 * Both are accepted and both are checked for exact representability, so no
 * precision is ever lost silently. `parseFloat` is never used: it would turn an
 * unrepresentable amount into a plausible wrong one.
 */
export const bigIntegerSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      ctx.addIssue({ code: 'custom', message: 'unsafe_integer' });
      return z.NEVER;
    }
    return value;
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    ctx.addIssue({ code: 'custom', message: 'not_an_integer' });
    return z.NEVER;
  }
  const parsed = Number(trimmed);
  // A BIGINT beyond the safe range would round here, so it is rejected instead:
  // a money round trip must be exact to be trusted.
  if (!Number.isSafeInteger(parsed) || String(parsed) !== trimmed) {
    ctx.addIssue({ code: 'custom', message: 'unsafe_integer' });
    return z.NEVER;
  }
  return parsed;
});

const epochMs = bigIntegerSchema.refine((value) => value >= 0, { message: 'negative_timestamp' });
const nullableEpochMs = z.union([z.null(), epochMs]);
const nullableText = z.string().nullable();
const serverRevision = bigIntegerSchema.refine((value) => value > 0, {
  message: 'invalid_revision',
});
const nullableSyncId = z.union([z.null(), syncIdSchema]);

const serverColumns = {
  server_revision: serverRevision,
  server_updated_at: z.string().min(1),
};

export const pulledAccountSchema = z
  .object({
    sync_id: syncIdSchema,
    user_id: userIdSchema,
    name: z.string().min(1),
    type: z.enum(ACCOUNT_TYPES),
    opening_balance_minor: bigIntegerSchema,
    currency: currencySchema,
    icon: nullableText,
    is_archived: z.boolean(),
    created_at: epochMs,
    updated_at: epochMs,
    deleted_at: nullableEpochMs,
    ...serverColumns,
  })
  .strict();

export const pulledCategorySchema = z
  .object({
    sync_id: syncIdSchema,
    user_id: userIdSchema,
    name: z.string().min(1),
    type: z.enum(CATEGORY_TYPES),
    icon: nullableText,
    system_key: nullableText,
    is_default: z.boolean(),
    created_at: epochMs,
    updated_at: epochMs,
    deleted_at: nullableEpochMs,
    ...serverColumns,
  })
  .strict();

export const pulledPersonSchema = z
  .object({
    sync_id: syncIdSchema,
    user_id: userIdSchema,
    name: z.string().min(1),
    note: nullableText,
    is_archived: z.boolean(),
    created_at: epochMs,
    updated_at: epochMs,
    deleted_at: nullableEpochMs,
    ...serverColumns,
  })
  .strict();

export const pulledSettingsSchema = z
  .object({
    sync_id: syncIdSchema,
    user_id: userIdSchema,
    default_currency: currencySchema,
    created_at: epochMs,
    updated_at: epochMs,
    deleted_at: nullableEpochMs,
    ...serverColumns,
  })
  .strict();

export const pulledTransactionSchema = z
  .object({
    sync_id: syncIdSchema,
    user_id: userIdSchema,
    type: z.enum(TRANSACTION_TYPES),
    amount_minor: bigIntegerSchema.refine((value) => value > 0, { message: 'non_positive_amount' }),
    currency: currencySchema,
    category_sync_id: nullableSyncId,
    source_account_sync_id: nullableSyncId,
    destination_account_sync_id: nullableSyncId,
    person_sync_id: nullableSyncId,
    payment_mode: z.union([z.null(), z.enum(PAYMENT_MODES)]),
    transaction_date: epochMs,
    title: z.string(),
    note: nullableText,
    created_at: epochMs,
    updated_at: epochMs,
    deleted_at: nullableEpochMs,
    ...serverColumns,
  })
  .strict();

export type PulledAccountRow = z.infer<typeof pulledAccountSchema>;
export type PulledCategoryRow = z.infer<typeof pulledCategorySchema>;
export type PulledPersonRow = z.infer<typeof pulledPersonSchema>;
export type PulledSettingsRow = z.infer<typeof pulledSettingsSchema>;
export type PulledTransactionRow = z.infer<typeof pulledTransactionSchema>;

export type PulledRow =
  PulledAccountRow | PulledCategoryRow | PulledPersonRow | PulledSettingsRow | PulledTransactionRow;

const pullSchemasByEntity = {
  account: pulledAccountSchema,
  category: pulledCategorySchema,
  person: pulledPersonSchema,
  settings: pulledSettingsSchema,
  transaction: pulledTransactionSchema,
} as const;

/** Decodes one downloaded row. Returns an issue path only, never row values. */
export function decodePulledRow(
  entityType: SyncEntityType,
  row: unknown,
): { ok: true; row: PulledRow } | { ok: false; issue: string } {
  const parsed = pullSchemasByEntity[entityType].safeParse(row);
  if (parsed.success) return { ok: true, row: parsed.data as PulledRow };
  const first = parsed.error.issues[0];
  return { ok: false, issue: first === undefined ? 'unknown' : first.path.join('.') || 'row' };
}

/** The columns pull requests, so no unexpected server column can arrive. */
export const PULLED_COLUMNS = {
  account: Object.keys(pulledAccountSchema.shape).join(','),
  category: Object.keys(pulledCategorySchema.shape).join(','),
  person: Object.keys(pulledPersonSchema.shape).join(','),
  settings: Object.keys(pulledSettingsSchema.shape).join(','),
  transaction: Object.keys(pulledTransactionSchema.shape).join(','),
} as const satisfies Record<SyncEntityType, string>;

/**
 * `sync.sync_changes` names the cloud table a change came from. Pull works in
 * local entity vocabulary, so the two are mapped here rather than compared as
 * loose strings.
 */
const ENTITY_TYPE_BY_TABLE = new Map<string, SyncEntityType>(
  SYNC_ENTITY_TYPES.map((entityType) => [REMOTE_TABLES[entityType].table, entityType]),
);

export const remoteChangeSchema = z
  .object({
    sequence: bigIntegerSchema.refine((value) => value > 0, { message: 'invalid_sequence' }),
    user_id: userIdSchema,
    entity_type: z.string().min(1),
    entity_sync_id: syncIdSchema,
    server_revision: serverRevision,
  })
  .strict();

export const REMOTE_CHANGE_COLUMNS = 'sequence,user_id,entity_type,entity_sync_id,server_revision';

/** One cloud change, in local vocabulary. */
export type RemoteChange = {
  sequence: number;
  userId: string;
  entityType: SyncEntityType;
  entitySyncId: string;
  serverRevision: number;
};

export function decodeRemoteChange(
  row: unknown,
): { ok: true; change: RemoteChange } | { ok: false; issue: string } {
  const parsed = remoteChangeSchema.safeParse(row);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, issue: first === undefined ? 'unknown' : first.path.join('.') || 'row' };
  }
  const entityType = ENTITY_TYPE_BY_TABLE.get(parsed.data.entity_type);
  if (entityType === undefined) return { ok: false, issue: 'entity_type' };
  return {
    ok: true,
    change: {
      sequence: parsed.data.sequence,
      userId: parsed.data.user_id,
      entityType,
      entitySyncId: parsed.data.entity_sync_id,
      serverRevision: parsed.data.server_revision,
    },
  };
}
