import type { SyncEntityType } from '@/db/schema';

import {
  MappingError,
  mapLocalAccountToRemote,
  mapLocalCategoryToRemote,
  mapLocalPersonToRemote,
  mapLocalSettingsToRemote,
  mapLocalTransactionToRemote,
  type MappingContext,
  type RelationResolver,
} from './mapping/local-to-remote';
import { validateRemoteRow, type RemoteRow } from './remote/remote-rows';
import type {
  RemoteSnapshotRepository,
  RemoteSyncRepository,
} from './remote/supabase-sync.repository';
import { readLocalSnapshot, type LocalSnapshot } from './sync-source.repository';

/**
 * The one-time upload of a whole local database to a cloud account.
 *
 * Push exists to propagate changes and reads only the outbox, which is exactly
 * right for ongoing sync and exactly wrong here: records that predate the outbox
 * — every row on a device that has been used offline for months — have no queued
 * work at all. Faking their upload by generating thousands of mutations would
 * corrupt queue ordering and lose the distinction between "the user changed
 * this" and "this has never been uploaded". So this reads the current dataset
 * directly and uploads it, leaving push's semantics untouched.
 *
 * Every write is an identity-keyed upsert, so a run that fails half-way can
 * simply be repeated: rows already uploaded converge on themselves.
 */

/** Rows per remote statement. Bounded so a large database uploads in steps. */
export const INITIAL_UPLOAD_BATCH_SIZE = 100;

/** Rows per page when reading the cloud's existing identities. */
export const CLOUD_IDENTITY_PAGE_SIZE = 500;

/** Parents before children: a cloud transaction has foreign keys to all three. */
const UPLOAD_ORDER: readonly SyncEntityType[] = [
  'settings',
  'account',
  'category',
  'person',
  'transaction',
];

/** Children before parents, so an obsolete parent is never hidden first. */
const TOMBSTONE_ORDER: readonly SyncEntityType[] = [
  'transaction',
  'account',
  'category',
  'person',
  'settings',
];

export class InitialUploadError extends Error {
  constructor(
    readonly reason: 'invalid_local_data' | 'remote',
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`Initial upload failed: ${reason} (${detail})`, options);
    this.name = 'InitialUploadError';
  }
}

export type InitialUploadResult = {
  uploaded: number;
  tombstoned: number;
};

export type InitialUploadOptions = {
  userId: string;
  remote: RemoteSyncRepository;
  /** Present only when obsolete cloud rows must be retired as well. */
  snapshots?: RemoteSnapshotRepository;
  snapshot?: LocalSnapshot;
  batchSize?: number;
};

/**
 * Uploads the complete local dataset.
 *
 * `replaceCloudDataset` additionally retires cloud records this device does not
 * have. Without that step a "use this device's data" choice would leave the
 * other device's rows in the cloud, and the very next pull would download them
 * back as if they had never been replaced.
 */
export async function performInitialUpload(
  options: InitialUploadOptions & { replaceCloudDataset?: boolean },
): Promise<InitialUploadResult> {
  const snapshot = options.snapshot ?? readLocalSnapshot();
  const batchSize = options.batchSize ?? INITIAL_UPLOAD_BATCH_SIZE;
  const context: MappingContext = { userId: options.userId };
  const resolver = buildResolver(snapshot);

  let uploaded = 0;
  for (const entityType of UPLOAD_ORDER) {
    const rows = mapEntity(entityType, snapshot, context, resolver);
    for (const batch of chunk(rows, batchSize)) {
      await upload(options.remote, entityType, batch);
      uploaded += batch.length;
    }
  }

  let tombstoned = 0;
  if (options.replaceCloudDataset === true) {
    if (options.snapshots === undefined) {
      throw new InitialUploadError('remote', 'snapshot_repository_required');
    }
    tombstoned = await retireObsoleteCloudRows(
      options.remote,
      options.snapshots,
      snapshot,
      batchSize,
    );
  }

  return { uploaded, tombstoned };
}

/**
 * Tombstones cloud rows whose identity is absent from this device.
 *
 * The downloaded row is re-uploaded carrying `deleted_at` rather than deleted,
 * so the retirement travels to other devices as an ordinary tombstone and the
 * cloud keeps its history. Children are retired before parents.
 */
async function retireObsoleteCloudRows(
  remote: RemoteSyncRepository,
  snapshots: RemoteSnapshotRepository,
  snapshot: LocalSnapshot,
  batchSize: number,
): Promise<number> {
  const localIdentities = localIdentitiesOf(snapshot);
  const deletedAt = Date.now();
  let tombstoned = 0;

  for (const entityType of TOMBSTONE_ORDER) {
    const obsolete: RemoteRow[] = [];
    for (const row of await readAllCloudRows(snapshots, entityType)) {
      const syncId = String(row.sync_id);
      if (localIdentities[entityType].has(syncId)) continue;
      if (row.deleted_at !== null && row.deleted_at !== undefined) continue;
      const { server_revision: _revision, server_updated_at: _updatedAt, ...values } = row;
      obsolete.push({ ...values, deleted_at: deletedAt } as unknown as RemoteRow);
    }
    for (const batch of chunk(obsolete, batchSize)) {
      await upload(remote, entityType, batch);
      tombstoned += batch.length;
    }
  }
  return tombstoned;
}

/** Every cloud row for one entity type, paged by identity. */
export async function readAllCloudRows(
  snapshots: RemoteSnapshotRepository,
  entityType: SyncEntityType,
  pageSize = CLOUD_IDENTITY_PAGE_SIZE,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let afterSyncId: string | null = null;

  for (;;) {
    const page = (await snapshots.fetchRowPage(entityType, {
      afterSyncId,
      limit: pageSize,
    })) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    const last = page.at(-1);
    const nextCursor = last === undefined ? null : String(last.sync_id);
    // Without a moving cursor the loop would read the same page forever.
    if (nextCursor === null || nextCursor === afterSyncId) return rows;
    afterSyncId = nextCursor;
  }
}

function localIdentitiesOf(snapshot: LocalSnapshot): Record<SyncEntityType, Set<string>> {
  const identities = (rows: { syncId: string | null }[]) =>
    new Set(rows.map((row) => row.syncId).filter((syncId): syncId is string => syncId !== null));
  return {
    account: identities(snapshot.accounts),
    category: identities(snapshot.categories),
    person: identities(snapshot.people),
    settings: identities(snapshot.settings),
    transaction: identities(snapshot.transactions),
  };
}

function mapEntity(
  entityType: SyncEntityType,
  snapshot: LocalSnapshot,
  context: MappingContext,
  resolver: RelationResolver,
): RemoteRow[] {
  const mapped = (() => {
    switch (entityType) {
      case 'account':
        return snapshot.accounts.map((row) => mapLocalAccountToRemote(row, context));
      case 'category':
        return snapshot.categories.map((row) => mapLocalCategoryToRemote(row, context));
      case 'person':
        return snapshot.people.map((row) => mapLocalPersonToRemote(row, context));
      case 'settings':
        return snapshot.settings.map((row) => mapLocalSettingsToRemote(row, context));
      case 'transaction':
        return snapshot.transactions.map((row) =>
          mapLocalTransactionToRemote(row, context, resolver),
        );
    }
  })();

  return mapped.map((row) => {
    // The same contract push validates against: nothing malformed leaves the
    // device, and a local row that cannot be represented fails here rather than
    // being rejected row-by-row by a remote constraint.
    const validated = validateRemoteRow(entityType, row);
    if (!validated.ok) throw new InitialUploadError('invalid_local_data', validated.issue);
    return validated.row;
  });
}

/** Local integer foreign keys resolved from the snapshot itself, with no extra queries. */
function buildResolver(snapshot: LocalSnapshot): RelationResolver {
  const index = (rows: { id: number; syncId: string | null }[]) =>
    new Map(
      rows
        .filter((row) => row.syncId !== null)
        .map((row) => [row.id, row.syncId as string] as const),
    );
  const accounts = index(snapshot.accounts);
  const categories = index(snapshot.categories);
  const people = index(snapshot.people);
  return {
    account: (localId) => accounts.get(localId),
    category: (localId) => categories.get(localId),
    person: (localId) => people.get(localId),
  };
}

async function upload(remote: RemoteSyncRepository, entityType: SyncEntityType, rows: RemoteRow[]) {
  if (rows.length === 0) return;
  try {
    await remote.upsert(entityType, rows);
  } catch (error) {
    if (error instanceof MappingError) {
      throw new InitialUploadError('invalid_local_data', 'unresolved_relation', { cause: error });
    }
    throw new InitialUploadError('remote', entityType, { cause: error });
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
