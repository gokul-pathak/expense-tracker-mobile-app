import type { SyncEntityType } from '@/db/schema';

import { summarizeCloudInventory, type DataInventory } from './data-inventory';
import {
  mapPulledAccountToLocal,
  mapPulledCategoryToLocal,
  mapPulledPersonToLocal,
  mapPulledSettingsToLocal,
  mapPulledTransactionToLocal,
} from './mapping/remote-to-local';
import { readAllCloudRows } from './initial-upload.service';
import {
  decodePulledRow,
  type PulledAccountRow,
  type PulledCategoryRow,
  type PulledPersonRow,
  type PulledSettingsRow,
  type PulledTransactionRow,
} from './remote/remote-pull-rows';
import type { RemoteSnapshotRepository } from './remote/supabase-sync.repository';
import type { RemoteDataset } from './remote-apply.repository';
import {
  findDebtViolation,
  isDebtType,
  validateRemoteTransaction,
  type DebtContribution,
  type DebtType,
  type RemoteRelationIndex,
} from './remote-domain-validation';

/**
 * Downloading and vetting a whole cloud account before it is allowed to replace
 * a device's data.
 *
 * The order matters more than it looks. Every row is downloaded and checked
 * first, and only a dataset that passes completely is handed on to the atomic
 * replacement. Discovering an invalid row after the local tables were cleared
 * would leave a person with neither their old data nor usable new data, which is
 * the one outcome this whole flow exists to prevent.
 */

export type CloudSnapshot = {
  accounts: PulledAccountRow[];
  categories: PulledCategoryRow[];
  people: PulledPersonRow[];
  settings: PulledSettingsRow[];
  transactions: PulledTransactionRow[];
  /** Cursor position this snapshot corresponds to. */
  latestSequence: number;
};

export type CloudSnapshotFailureReason =
  | 'remote'
  | 'invalid_remote_data'
  | 'foreign_owner'
  | 'unknown_parent'
  | 'domain_invariant'
  | 'unsupported_remote_data';

export class CloudSnapshotError extends Error {
  constructor(
    readonly reason: CloudSnapshotFailureReason,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    // Classification only: never a downloaded value.
    super(`Cloud data could not be used: ${reason} (${detail})`, options);
    this.name = 'CloudSnapshotError';
  }
}

/**
 * Reads the account's whole dataset and its current change position.
 *
 * The position is read *before* the rows. A change made while the download runs
 * then lands after the recorded cursor and is picked up by the next pull, rather
 * than being skipped by a cursor that claims to be newer than the data.
 */
export async function downloadCloudSnapshot(
  snapshots: RemoteSnapshotRepository,
  linkedUserId: string,
): Promise<CloudSnapshot> {
  let latestSequence: number;
  const raw: Partial<Record<SyncEntityType, Record<string, unknown>[]>> = {};
  try {
    latestSequence = await snapshots.fetchLatestSequence();
    for (const entityType of [
      'settings',
      'account',
      'category',
      'person',
      'transaction',
    ] as const) {
      raw[entityType] = await readAllCloudRows(snapshots, entityType);
    }
  } catch (error) {
    throw new CloudSnapshotError('remote', 'download', { cause: error });
  }

  return {
    settings: decodeAll('settings', raw.settings ?? [], linkedUserId),
    accounts: decodeAll('account', raw.account ?? [], linkedUserId),
    categories: decodeAll('category', raw.category ?? [], linkedUserId),
    people: decodeAll('person', raw.person ?? [], linkedUserId),
    transactions: decodeAll('transaction', raw.transaction ?? [], linkedUserId),
    latestSequence,
  };
}

function decodeAll<T>(
  entityType: SyncEntityType,
  rows: readonly Record<string, unknown>[],
  linkedUserId: string,
): T[] {
  return rows.map((row) => {
    const parsed = decodePulledRow(entityType, row);
    if (!parsed.ok) throw new CloudSnapshotError('invalid_remote_data', parsed.issue);
    // Row level security already scopes the query, but a client that trusts the
    // server completely has no defence left when that assumption breaks.
    if (parsed.row.user_id !== linkedUserId) {
      throw new CloudSnapshotError('foreign_owner', entityType);
    }
    return parsed.row as T;
  });
}

/**
 * Checks the dataset as a whole: relations resolve inside it, every transaction
 * satisfies its domain shape, and no person's repayments exceed their principal.
 */
export function validateCloudSnapshot(snapshot: CloudSnapshot): void {
  if (snapshot.settings.length > 1) {
    throw new CloudSnapshotError('invalid_remote_data', 'multiple_settings_rows');
  }
  assertUniqueIdentities(snapshot);

  const relations: RemoteRelationIndex = {
    accounts: new Map(
      snapshot.accounts.map((row) => [
        row.sync_id,
        { currency: row.currency, isArchived: row.is_archived },
      ]),
    ),
    categoryTypes: new Map(snapshot.categories.map((row) => [row.sync_id, row.type])),
    people: new Set(snapshot.people.map((row) => row.sync_id)),
  };

  for (const row of snapshot.transactions) {
    const problem = validateRemoteTransaction(row, relations, row.deleted_at !== null);
    if (problem !== undefined) throw new CloudSnapshotError(problem.code, problem.detail);
  }

  // Applied in a stable order so a repayment is never blamed for a principal
  // that simply sorts after it.
  const debts: DebtContribution<string>[] = [...snapshot.transactions]
    .filter((row) => row.deleted_at === null && isDebtType(row.type) && row.person_sync_id !== null)
    .sort(
      (left, right) => left.created_at - right.created_at || compare(left.sync_id, right.sync_id),
    )
    .map((row) => ({
      key: row.sync_id,
      personSyncId: row.person_sync_id!,
      type: row.type as DebtType,
      amountMinor: row.amount_minor,
      currency: row.currency,
    }));

  const violation = findDebtViolation([], debts);
  if (violation !== undefined) {
    throw new CloudSnapshotError('domain_invariant', violation.problem);
  }
}

function assertUniqueIdentities(snapshot: CloudSnapshot) {
  const groups: [SyncEntityType, { sync_id: string }[]][] = [
    ['account', snapshot.accounts],
    ['category', snapshot.categories],
    ['person', snapshot.people],
    ['transaction', snapshot.transactions],
    ['settings', snapshot.settings],
  ];
  for (const [entityType, rows] of groups) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.sync_id)) {
        throw new CloudSnapshotError('invalid_remote_data', `duplicate_${entityType}`);
      }
      seen.add(row.sync_id);
    }
  }
}

/**
 * The validated snapshot in the shape the local apply path accepts.
 *
 * Ordering within transactions does not matter: the replacement inserts every
 * account, category and person before the first transaction, so each relation
 * resolves by identity as it lands.
 */
export function toRemoteDataset(snapshot: CloudSnapshot): RemoteDataset {
  return {
    settings: snapshot.settings.map(mapPulledSettingsToLocal),
    accounts: snapshot.accounts.map(mapPulledAccountToLocal),
    categories: snapshot.categories.map(mapPulledCategoryToLocal),
    people: snapshot.people.map(mapPulledPersonToLocal),
    transactions: snapshot.transactions.map(mapPulledTransactionToLocal),
  };
}

/** Per-record cloud revisions, so the restored device knows where it stands. */
export function snapshotBaselines(snapshot: CloudSnapshot): {
  entityType: SyncEntityType;
  entitySyncId: string;
  serverRevision: number;
  deleted: boolean;
}[] {
  const groups: [
    SyncEntityType,
    { sync_id: string; server_revision: number; deleted_at: number | null }[],
  ][] = [
    ['settings', snapshot.settings],
    ['account', snapshot.accounts],
    ['category', snapshot.categories],
    ['person', snapshot.people],
    ['transaction', snapshot.transactions],
  ];
  return groups.flatMap(([entityType, rows]) =>
    rows.map((row) => ({
      entityType,
      entitySyncId: row.sync_id,
      serverRevision: row.server_revision,
      deleted: row.deleted_at !== null,
    })),
  );
}

/** What a person would recognise as "this account already has data". */
export function cloudInventoryOf(snapshot: CloudSnapshot): DataInventory {
  const live = <T extends { deleted_at: number | null }>(rows: T[]) =>
    rows.filter((row) => row.deleted_at === null);
  return summarizeCloudInventory({
    accounts: live(snapshot.accounts).length,
    transactions: live(snapshot.transactions).length,
    people: live(snapshot.people).length,
    customCategories: live(snapshot.categories).filter((row) => !row.is_default).length,
    settingsCurrency: live(snapshot.settings)[0]?.default_currency ?? null,
  });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
