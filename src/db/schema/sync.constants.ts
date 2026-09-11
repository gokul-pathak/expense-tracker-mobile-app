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
  'budget',
  'recurring_template',
  'recurring_occurrence',
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

/**
 * Canonical shape of a global sync identity: a lowercase RFC 4122 UUID of
 * version 4 or version 5.
 *
 * Version 4 is random and is what every ordinary record gets. Version 5 is
 * name-based: the same namespace and name always produce the same identity, on
 * any device, with no coordination. It exists for one purpose — two offline
 * devices that both generate the same recurring occurrence must give it, and
 * the transaction it produces, one identity, or they would record the same
 * rent twice. Nothing else in the app issues a version 5 identity.
 *
 * The nil UUID, and every other version, is refused. That matters to the cloud
 * budget index, which collapses the overall budget's null category onto the nil
 * UUID precisely because no real identity can ever equal it.
 */
export const SYNC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSyncId(value: unknown): value is string {
  return typeof value === 'string' && SYNC_ID_PATTERN.test(value);
}

export function isSyncEntityType(value: unknown): value is SyncEntityType {
  return typeof value === 'string' && SYNC_ENTITY_TYPES.includes(value as SyncEntityType);
}

export function isSyncOperation(value: unknown): value is SyncOperation {
  return typeof value === 'string' && SYNC_OPERATIONS.includes(value as SyncOperation);
}

/**
 * How Pull Sync resolved one detected conflict. Recorded for diagnostics and a
 * future "Attention Required" surface; never a copy of the financial record.
 */
export const SYNC_CONFLICT_RESOLUTIONS = [
  'remote_wins',
  'local_wins',
  'remote_delete_wins',
  'local_delete_wins',
  'converged_delete',
  'attention_required',
] as const;

export type SyncConflictResolution = (typeof SYNC_CONFLICT_RESOLUTIONS)[number];

/**
 * The remote change position a device has safely applied. `sync_changes.sequence`
 * starts at 1, so zero means "nothing applied yet", which is deliberately not the
 * same as "up to date".
 */
export const PULL_CURSOR_START = 0;
