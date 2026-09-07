/**
 * Centralized sync vocabulary. Schema, repositories, and services must compare
 * against these values instead of ad-hoc strings.
 */
export const SYNC_ENTITY_TYPES = [
  'account',
  'category',
  'person',
  'transaction',
  'settings',
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_OPERATIONS = ['upsert', 'delete'] as const;

export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

/**
 * Where a local write came from. Only `local` produces outbox work:
 * `remote` is a future Pull Sync apply, `migration` is schema/seed maintenance.
 */
export const MUTATION_ORIGINS = ['local', 'remote', 'migration'] as const;

export type MutationOrigin = (typeof MUTATION_ORIGINS)[number];

/** Canonical shape of a global sync identity (RFC 4122 UUID v4, lowercase). */
export const SYNC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSyncId(value: unknown): value is string {
  return typeof value === 'string' && SYNC_ID_PATTERN.test(value);
}

export function isSyncEntityType(value: unknown): value is SyncEntityType {
  return typeof value === 'string' && SYNC_ENTITY_TYPES.includes(value as SyncEntityType);
}

export function isSyncOperation(value: unknown): value is SyncOperation {
  return typeof value === 'string' && SYNC_OPERATIONS.includes(value as SyncOperation);
}
