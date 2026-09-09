import type { SyncEntityType, SyncOperation } from '@/db/schema';

import {
  mapPulledAccountToLocal,
  mapPulledBudgetToLocal,
  mapPulledCategoryToLocal,
  mapPulledPersonToLocal,
  mapPulledSettingsToLocal,
  mapPulledTransactionToLocal,
} from './mapping/remote-to-local';
import type { PullConflictOutcome, PullFailure } from './pull-sync.types';
import {
  decodePulledRow,
  type PulledAccountRow,
  type PulledBudgetRow,
  type PulledCategoryRow,
  type PulledPersonRow,
  type PulledRow,
  type PulledSettingsRow,
  type PulledTransactionRow,
  type RemoteChange,
} from './remote/remote-pull-rows';
import type {
  RemoteAccount,
  RemoteBudget,
  RemoteCategory,
  RemotePerson,
  RemoteSettings,
  RemoteTransaction,
} from './remote-apply.repository';
import {
  findDebtViolation,
  isDebtType,
  validateRemoteBudget,
  validateRemoteTransaction,
  type DebtContribution,
  type DebtType,
  type RemoteRelationIndex,
} from './remote-domain-validation';
import { readSyncBaselines } from './sync-baseline.repository';
import { readPendingSyncMutations } from './sync.repository';
import {
  readAccountCurrenciesBySyncId,
  readCategoryTypesBySyncId,
  readLocalCategoryBySystemKey,
  readLocalDebtRowsForPeople,
  readLocalEntity,
  readLocalRowsBySyncIds,
  readLocalSettingsSyncId,
  type LocalDebtRow,
} from './sync-source.repository';

/**
 * Turning one downloaded batch into a decision per record.
 *
 * Nothing here writes. Planning answers three questions and hands the answers to
 * the caller as data:
 *
 * 1. Is this row trustworthy — schema, ownership, money, domain invariants?
 * 2. Did this record move on both devices, and if so which side wins?
 * 3. In what order can the surviving writes run without a child reaching SQLite
 *    before its parent?
 *
 * A batch is applied as a prefix. When a change cannot be trusted, planning
 * reports its position so the caller applies everything before it and leaves the
 * cursor there. A rejected record is never stepped over: a cursor that moves
 * past a record it never applied loses that record forever.
 */

type PendingEntry = {
  id: number;
  revision: number;
  operation: SyncOperation;
  baseServerRevision: number | null;
};

type LocalRowRef = { id: number; deletedAt: Date | null };

export type PullBatchInput = {
  /** Change-feed rows in server sequence order. */
  changes: RemoteChange[];
  /** Raw current rows keyed by identity, exactly as downloaded. */
  rows: Map<SyncEntityType, Map<string, unknown>>;
  linkedUserId: string;
};

export type OutboxOperation =
  | { op: 'remove'; id: number; revision: number }
  | { op: 'rebase'; id: number; revision: number; base: number }
  | { op: 'rekey'; entityType: SyncEntityType; from: string; to: string };

export type PlannedWrite =
  | { write: 'account'; row: RemoteAccount }
  | { write: 'budget'; row: RemoteBudget }
  | { write: 'category'; row: RemoteCategory }
  | { write: 'person'; row: RemotePerson }
  | { write: 'settings'; row: RemoteSettings }
  | { write: 'transaction'; row: RemoteTransaction }
  | { write: 'tombstone'; entityType: SyncEntityType; syncId: string; deletedAt: Date }
  | { write: 'rebind-category'; systemKey: string; syncId: string }
  | { write: 'rebind-settings'; syncId: string };

export type PlannedItem = {
  entityType: SyncEntityType;
  syncId: string;
  sequence: number;
  serverRevision: number;
  remoteDeleted: boolean;
  /** Domain writes, in the order they must run inside their phase. */
  writes: PlannedWrite[];
  outbox: OutboxOperation[];
  /**
   * Queue entry observed while planning. If it has changed by the time the batch
   * commits, the local record moved during the pull, and the remote write is
   * abandoned rather than overwriting the newer local edit.
   */
  observedPending: { id: number; revision: number } | null;
  /** Identity a pending entry may still be filed under, before a rebind. */
  pendingLookupSyncId: string;
  /**
   * Present when this record's cloud identity differs from its local one. It is
   * applied whichever side wins the record's values, because identity is shared
   * state rather than a user-editable field.
   */
  identityRebind?: PlannedWrite;
  /** Tombstones apply whatever happened locally: a delete always wins. */
  guardAgainstLocalMutation: boolean;
  conflict?: PullConflictOutcome;
  /**
   * Recorded for the audit trail but not counted as a conflict: reconciling a
   * record's cloud identity is expected on a second device, not a divergence
   * anyone needs to look at.
   */
  audit?: PullConflictOutcome;
  counts: { applied: number; deleted: number };
};

export type PullPlan = {
  items: PlannedItem[];
  /** Number of input changes this plan covers, always a prefix. */
  coveredChanges: number;
  /** Present when planning stopped early. The cursor must stay before this. */
  stoppedAt?: { index: number; failure: PullFailure };
};

/**
 * Builds the largest safe prefix of a batch.
 *
 * Planning retries on a shorter prefix whenever a change cannot be applied, so
 * one bad record does not discard the good records before it. The horizon
 * strictly decreases, so this terminates.
 */
export function planPullBatch(input: PullBatchInput): PullPlan {
  let horizon = input.changes.length;
  let stoppedAt: { index: number; failure: PullFailure } | undefined;

  while (horizon > 0) {
    const attempt = planPrefix(input, horizon);
    if (attempt.ok) return { items: attempt.items, coveredChanges: horizon, stoppedAt };
    stoppedAt = { index: attempt.index, failure: attempt.failure };
    horizon = attempt.index;
  }

  return { items: [], coveredChanges: 0, stoppedAt };
}

type PrefixResult =
  { ok: true; items: PlannedItem[] } | { ok: false; index: number; failure: PullFailure };

type DecodedEntry = { change: RemoteChange; row: PulledRow; index: number };

function planPrefix(input: PullBatchInput, horizon: number): PrefixResult {
  const identities = collectIdentities(input.changes.slice(0, horizon));
  const decoded = new Map<string, DecodedEntry>();

  for (const [key, identity] of identities) {
    const { change, index } = identity;
    const raw = input.rows.get(change.entityType)?.get(change.entitySyncId);
    if (raw === undefined) {
      // Settings are identified in the cloud by their owner, not by their sync
      // ID, so an upload from another device can retire one identity in favour
      // of another. A change naming an identity that no longer exists is
      // therefore obsolete rather than missing, and there is nothing to apply.
      if (change.entityType === 'settings') continue;
      // Every other change naming a row the query did not return is a real
      // record. Skipping it would hide it behind an advancing cursor, so the
      // run stops here instead.
      return { ok: false, index, failure: failureFor(change, 'remote_row_missing') };
    }

    const parsed = decodePulledRow(change.entityType, raw);
    if (!parsed.ok) {
      return { ok: false, index, failure: failureFor(change, 'invalid_remote_data', parsed.issue) };
    }

    // Row level security already scopes the query, but a client with no defence
    // of its own has none left when that assumption breaks.
    if (parsed.row.user_id !== input.linkedUserId) {
      return { ok: false, index, failure: failureFor(change, 'foreign_owner') };
    }

    decoded.set(key, { change, row: parsed.row, index });
  }

  const context = readLocalContext(decoded);
  const items: PlannedItem[] = [];

  for (const entry of decoded.values()) {
    const decision = decide(entry, context);
    if (!decision.ok) return { ok: false, index: entry.index, failure: decision.failure };
    items.push(decision.item);
  }

  const invariant = validateDebtInvariants(items, decoded, context);
  if (invariant !== undefined) {
    return { ok: false, index: invariant.index, failure: invariant.failure };
  }

  return { ok: true, items: orderByDependency(items) };
}

function failureFor(change: RemoteChange, code: PullFailure['code'], detail?: string): PullFailure {
  return {
    entityType: change.entityType,
    entitySyncId: change.entitySyncId,
    sequence: change.sequence,
    code,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * One entry per identity, keyed by entity type and sync ID.
 *
 * The change feed can name the same record several times — an edit, then another
 * edit, and the M7B trigger appends an extra row for a conflicting upsert. Pull
 * always applies a row's current state, so repeated changes for one identity
 * collapse into one decision. The earliest position is kept, because that is
 * where the cursor must stop if this record turns out to be unusable.
 */
function collectIdentities(changes: readonly RemoteChange[]): Map<string, Identity> {
  const identities = new Map<string, Identity>();
  changes.forEach((change, index) => {
    const key = identityKey(change.entityType, change.entitySyncId);
    const existing = identities.get(key);
    if (existing === undefined) {
      identities.set(key, { change, index });
      return;
    }
    if (change.serverRevision > existing.change.serverRevision) {
      identities.set(key, { change, index: existing.index });
    }
  });
  return identities;
}

type Identity = { change: RemoteChange; index: number };

function identityKey(entityType: SyncEntityType, syncId: string): string {
  return `${entityType}:${syncId}`;
}

type LocalContext = {
  localRows: Map<SyncEntityType, Map<string, LocalRowRef>>;
  pending: Map<SyncEntityType, Map<string, PendingEntry>>;
  baselines: Map<SyncEntityType, Map<string, { serverRevision: number; deleted: boolean }>>;
  localSettingsSyncId: string | null;
  /** Local rows plus the batch's own parents, which land before their children. */
  relations: RemoteRelationIndex;
  localDebtRows: LocalDebtRow[];
};

function readLocalContext(decoded: Map<string, DecodedEntry>): LocalContext {
  const identifiersByType = new Map<SyncEntityType, string[]>();
  for (const { change } of decoded.values()) {
    const list = identifiersByType.get(change.entityType) ?? [];
    list.push(change.entitySyncId);
    identifiersByType.set(change.entityType, list);
  }

  const localRows = new Map<SyncEntityType, Map<string, LocalRowRef>>();
  const pending = new Map<SyncEntityType, Map<string, PendingEntry>>();
  const baselines = new Map<
    SyncEntityType,
    Map<string, { serverRevision: number; deleted: boolean }>
  >();

  for (const [entityType, syncIds] of identifiersByType) {
    localRows.set(entityType, readLocalRowsBySyncIds(entityType, syncIds));
    pending.set(entityType, readPendingSyncMutations(entityType, syncIds));
    baselines.set(entityType, readSyncBaselines(entityType, syncIds));
  }

  const transactionRows = [...decoded.values()]
    .filter((entry) => entry.change.entityType === 'transaction')
    .map((entry) => entry.row as PulledTransactionRow);

  const referencedAccounts: string[] = [];
  const referencedCategories: string[] = [];
  const referencedPeople: string[] = [];
  for (const row of transactionRows) {
    if (row.source_account_sync_id !== null) referencedAccounts.push(row.source_account_sync_id);
    if (row.destination_account_sync_id !== null) {
      referencedAccounts.push(row.destination_account_sync_id);
    }
    if (row.category_sync_id !== null) referencedCategories.push(row.category_sync_id);
    if (row.person_sync_id !== null) referencedPeople.push(row.person_sync_id);
  }

  // A budget names a category too, and must be able to resolve one that already
  // exists locally as well as one arriving in this batch.
  for (const entry of decoded.values()) {
    if (entry.change.entityType !== 'budget') continue;
    const categorySyncId = (entry.row as PulledBudgetRow).category_sync_id;
    if (categorySyncId !== null) referencedCategories.push(categorySyncId);
  }

  const relations: RemoteRelationIndex = {
    accounts: new Map(),
    categoryTypes: new Map(),
    people: new Set(),
  };

  // Local parents first, so a parent that only exists locally still resolves.
  for (const [syncId, row] of readAccountCurrenciesBySyncId(referencedAccounts)) {
    relations.accounts.set(syncId, row);
  }
  for (const [syncId, type] of readCategoryTypesBySyncId(referencedCategories)) {
    relations.categoryTypes.set(syncId, type);
  }
  for (const syncId of readLocalRowsBySyncIds('person', referencedPeople).keys()) {
    relations.people.add(syncId);
  }

  // Then the batch's own parents, which are applied before their children and
  // therefore describe the state the children will see.
  for (const entry of decoded.values()) {
    if (entry.row.deleted_at !== null) continue;
    switch (entry.change.entityType) {
      case 'account': {
        const row = entry.row as PulledAccountRow;
        relations.accounts.set(row.sync_id, {
          currency: row.currency,
          isArchived: row.is_archived,
        });
        break;
      }
      case 'category': {
        const row = entry.row as PulledCategoryRow;
        relations.categoryTypes.set(row.sync_id, row.type);
        break;
      }
      case 'person':
        relations.people.add(entry.row.sync_id);
        break;
      default:
        break;
    }
  }

  return {
    localRows,
    pending,
    baselines,
    localSettingsSyncId: readLocalSettingsSyncId(),
    relations,
    localDebtRows: readLocalDebtRowsForPeople(referencedPeople),
  };
}

type Decision = { ok: true; item: PlannedItem } | { ok: false; failure: PullFailure };

function decide(entry: DecodedEntry, context: LocalContext): Decision {
  const { change, row } = entry;
  const entityType = change.entityType;
  const syncId = change.entitySyncId;
  const remoteDeleted = row.deleted_at !== null;
  // The row's own revision, not the change row's. The change feed can carry an
  // older or, because the M7B trigger fires before conflict detection, a
  // spurious position for an identity; the row is the state being applied.
  const serverRevision = row.server_revision;

  if (entityType === 'settings' && remoteDeleted) {
    // Nothing in the app deletes its settings singleton, and hiding it would
    // leave the device with no default currency.
    return {
      ok: false,
      failure: failureFor(change, 'unsupported_remote_data', 'settings_tombstone'),
    };
  }

  if (entityType === 'transaction') {
    const problem = validateRemoteTransaction(
      row as PulledTransactionRow,
      context.relations,
      remoteDeleted,
    );
    if (problem !== undefined) {
      return { ok: false, failure: failureFor(change, problem.code, problem.detail) };
    }
  }

  if (entityType === 'budget') {
    const problem = validateRemoteBudget(row as PulledBudgetRow, context.relations, remoteDeleted);
    if (problem !== undefined) {
      return { ok: false, failure: failureFor(change, problem.code, problem.detail) };
    }
  }

  const rebind = findIdentityRebind(entityType, row, context);
  const pendingByType = context.pending.get(entityType);
  const pendingEntry =
    pendingByType?.get(syncId) ??
    (rebind === undefined ? undefined : readPendingFor(entityType, rebind.previousSyncId));
  const baseline = context.baselines.get(entityType)?.get(syncId);
  const localRowExists =
    context.localRows.get(entityType)?.has(syncId) === true || rebind !== undefined;

  const base = pendingEntry?.baseServerRevision ?? baseline?.serverRevision ?? null;
  const item: PlannedItem = {
    entityType,
    syncId,
    sequence: change.sequence,
    serverRevision,
    remoteDeleted,
    writes: [],
    outbox: [],
    observedPending:
      pendingEntry === undefined ? null : { id: pendingEntry.id, revision: pendingEntry.revision },
    pendingLookupSyncId: rebind?.previousSyncId ?? syncId,
    guardAgainstLocalMutation: !remoteDeleted,
    counts: { applied: 0, deleted: 0 },
  };

  if (rebind !== undefined) {
    item.identityRebind = rebindWrite(entityType, rebind, syncId);
    item.outbox.push({ op: 'rekey', entityType, from: rebind.previousSyncId, to: syncId });
  }

  // Nothing pending locally: the cloud is the only side that moved.
  if (pendingEntry === undefined) {
    if (baseline !== undefined && serverRevision <= baseline.serverRevision) {
      // Already accounted for. Re-applying would be harmless, but a replay after
      // a crash should not rewrite rows it has already written.
      return { ok: true, item };
    }
    applyRemoteWinner(item, row, remoteDeleted, localRowExists);
    if (rebind !== undefined) {
      item.audit = conflictOf(item, null, base, 'remote_wins', rebindDetail(entityType));
    }
    return { ok: true, item };
  }

  // A local change is waiting. It is a conflict only if the cloud has moved past
  // the revision that local change was written on top of.
  if (base !== null && serverRevision <= base) {
    return { ok: true, item };
  }

  if (remoteDeleted) {
    // A tombstone always wins: a deleted financial record must not return
    // because another device edited it at the same time.
    const resolution =
      pendingEntry.operation === 'delete' ? 'converged_delete' : 'remote_delete_wins';
    applyRemoteWinner(item, row, true, localRowExists);
    item.outbox.push({ op: 'remove', id: pendingEntry.id, revision: pendingEntry.revision });
    item.conflict = conflictOf(item, pendingEntry.operation, base, resolution);
    return { ok: true, item };
  }

  if (pendingEntry.operation === 'delete') {
    // The mirror of the same rule: a local deletion is not undone by a remote
    // edit. The queued tombstone stays and propagates on the next push.
    item.outbox.push(rebase(pendingEntry, serverRevision));
    item.conflict = conflictOf(item, pendingEntry.operation, base, 'local_delete_wins');
    return { ok: true, item };
  }

  // Two ordinary edits. Under deterministic server-order last-write-wins the
  // local change has not reached the server yet, so it resolves later and wins.
  // Its queue entry stays; only its base moves, so the same remote revision is
  // not re-detected as a conflict on every later run.
  item.outbox.push(rebase(pendingEntry, serverRevision));
  if (!remoteEqualsLocal(entityType, row)) {
    item.conflict = conflictOf(item, pendingEntry.operation, base, 'local_wins');
  }
  return { ok: true, item };
}

function rebase(pendingEntry: PendingEntry, base: number): OutboxOperation {
  return { op: 'rebase', id: pendingEntry.id, revision: pendingEntry.revision, base };
}

function applyRemoteWinner(
  item: PlannedItem,
  row: PulledRow,
  remoteDeleted: boolean,
  localRowExists: boolean,
) {
  if (remoteDeleted) {
    item.counts.deleted += 1;
    if (!localRowExists) {
      // Nothing to hide locally. The baseline still records the deletion, so no
      // later reconciliation can resurrect the record.
      return;
    }
    item.writes.push({
      write: 'tombstone',
      entityType: item.entityType,
      syncId: item.syncId,
      deletedAt: new Date(row.deleted_at!),
    });
    return;
  }

  item.writes.push(domainWrite(item.entityType, row));
  item.counts.applied += 1;
}

function domainWrite(entityType: SyncEntityType, row: PulledRow): PlannedWrite {
  switch (entityType) {
    case 'account':
      return { write: 'account', row: mapPulledAccountToLocal(row as PulledAccountRow) };
    case 'budget':
      return { write: 'budget', row: mapPulledBudgetToLocal(row as PulledBudgetRow) };
    case 'category':
      return { write: 'category', row: mapPulledCategoryToLocal(row as PulledCategoryRow) };
    case 'person':
      return { write: 'person', row: mapPulledPersonToLocal(row as PulledPersonRow) };
    case 'settings':
      return { write: 'settings', row: mapPulledSettingsToLocal(row as PulledSettingsRow) };
    case 'transaction':
      return {
        write: 'transaction',
        row: mapPulledTransactionToLocal(row as PulledTransactionRow),
      };
  }
}

type IdentityRebind = { previousSyncId: string; systemKey?: string };

/**
 * Records whose cloud identity is not the identity this device gave them.
 *
 * Built-in categories are matched by `system_key` and the settings singleton by
 * ownership, so both legitimately arrive under an identity this device has never
 * seen. Rebinding is how a second device stops duplicating them — and it is
 * required, not cosmetic: the cloud enforces one built-in per `system_key` and
 * one settings row per user, so an upload under the old identity would collide.
 */
function findIdentityRebind(
  entityType: SyncEntityType,
  row: PulledRow,
  context: LocalContext,
): IdentityRebind | undefined {
  if (context.localRows.get(entityType)?.has(row.sync_id) === true) return undefined;

  if (entityType === 'category') {
    const systemKey = (row as PulledCategoryRow).system_key;
    if (systemKey === null) return undefined;
    const local = readLocalCategoryBySystemKey(systemKey);
    if (local === null || local.syncId === null || local.syncId === row.sync_id) return undefined;
    return { previousSyncId: local.syncId, systemKey };
  }

  if (entityType === 'settings') {
    const localSyncId = context.localSettingsSyncId;
    if (localSyncId === null || localSyncId === row.sync_id) return undefined;
    return { previousSyncId: localSyncId };
  }

  return undefined;
}

function rebindDetail(entityType: SyncEntityType): string {
  return entityType === 'category' ? 'system_key_rebind' : 'settings_owner_rebind';
}

function rebindWrite(
  entityType: SyncEntityType,
  rebind: IdentityRebind,
  syncId: string,
): PlannedWrite {
  return entityType === 'category' && rebind.systemKey !== undefined
    ? { write: 'rebind-category', systemKey: rebind.systemKey, syncId }
    : { write: 'rebind-settings', syncId };
}

function conflictOf(
  item: PlannedItem,
  localOperation: SyncOperation | null,
  base: number | null,
  resolution: PullConflictOutcome['resolution'],
  detail?: string,
): PullConflictOutcome {
  return {
    entityType: item.entityType,
    entitySyncId: item.syncId,
    localOperation,
    resolution,
    remoteServerRevision: item.serverRevision,
    baseServerRevision: base,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Whether the cloud row already says exactly what the local row says.
 *
 * This is the ordinary case after this device's own push: the change comes back
 * through the feed before its queue entry is cleared. Nothing diverged, so it is
 * deliberately not recorded as a conflict.
 */
function remoteEqualsLocal(entityType: SyncEntityType, row: PulledRow): boolean {
  const local = readLocalEntity(entityType, row.sync_id);
  if (local === null) return false;

  switch (local.entityType) {
    case 'account': {
      const remote = row as PulledAccountRow;
      return (
        local.row.name === remote.name &&
        local.row.type === remote.type &&
        local.row.openingBalanceMinor === remote.opening_balance_minor &&
        local.row.currency === remote.currency &&
        local.row.icon === remote.icon &&
        local.row.isArchived === remote.is_archived &&
        sameInstant(local.row.updatedAt, remote.updated_at) &&
        sameNullableInstant(local.row.deletedAt, remote.deleted_at)
      );
    }
    case 'category': {
      const remote = row as PulledCategoryRow;
      return (
        local.row.name === remote.name &&
        local.row.type === remote.type &&
        local.row.icon === remote.icon &&
        local.row.systemKey === remote.system_key &&
        local.row.isDefault === remote.is_default &&
        sameInstant(local.row.updatedAt, remote.updated_at) &&
        sameNullableInstant(local.row.deletedAt, remote.deleted_at)
      );
    }
    case 'person': {
      const remote = row as PulledPersonRow;
      return (
        local.row.name === remote.name &&
        local.row.note === remote.note &&
        local.row.isArchived === remote.is_archived &&
        sameInstant(local.row.updatedAt, remote.updated_at) &&
        sameNullableInstant(local.row.deletedAt, remote.deleted_at)
      );
    }
    case 'settings': {
      const remote = row as PulledSettingsRow;
      return (
        local.row.defaultCurrency === remote.default_currency &&
        sameInstant(local.row.updatedAt, remote.updated_at)
      );
    }
    case 'budget': {
      const remote = row as PulledBudgetRow;
      const categoryId =
        remote.category_sync_id === null
          ? null
          : (readLocalRowsBySyncIds('category', [remote.category_sync_id]).get(
              remote.category_sync_id,
            )?.id ?? null);
      return (
        local.row.categoryId === categoryId &&
        local.row.periodMonth === remote.period_month &&
        local.row.amountMinor === remote.amount_minor &&
        local.row.currency === remote.currency &&
        sameInstant(local.row.updatedAt, remote.updated_at) &&
        sameNullableInstant(local.row.deletedAt, remote.deleted_at)
      );
    }
    case 'transaction': {
      const remote = row as PulledTransactionRow;
      const relations = resolveLocalRelations(remote);
      return (
        local.row.type === remote.type &&
        local.row.amountMinor === remote.amount_minor &&
        local.row.currency === remote.currency &&
        local.row.title === remote.title &&
        local.row.note === remote.note &&
        local.row.paymentMode === remote.payment_mode &&
        local.row.categoryId === relations.categoryId &&
        local.row.sourceAccountId === relations.sourceAccountId &&
        local.row.destinationAccountId === relations.destinationAccountId &&
        local.row.personId === relations.personId &&
        sameInstant(local.row.transactionDate, remote.transaction_date) &&
        sameInstant(local.row.updatedAt, remote.updated_at) &&
        sameNullableInstant(local.row.deletedAt, remote.deleted_at)
      );
    }
  }
}

function resolveLocalRelations(row: PulledTransactionRow) {
  const localIdOf = (entityType: SyncEntityType, syncId: string | null): number | null => {
    if (syncId === null) return null;
    return readLocalRowsBySyncIds(entityType, [syncId]).get(syncId)?.id ?? null;
  };
  return {
    categoryId: localIdOf('category', row.category_sync_id),
    sourceAccountId: localIdOf('account', row.source_account_sync_id),
    destinationAccountId: localIdOf('account', row.destination_account_sync_id),
    personId: localIdOf('person', row.person_sync_id),
  };
}

function sameInstant(local: Date, remote: number): boolean {
  return local.getTime() === remote;
}

function sameNullableInstant(local: Date | null, remote: number | null): boolean {
  if (local === null) return remote === null;
  return remote !== null && local.getTime() === remote;
}

/**
 * Debt invariants across local history and the whole batch together.
 *
 * A principal and its repayment can arrive in one batch, and the repayment must
 * not be rejected because the principal is not committed yet. Equally, a batch
 * that would leave repayments exceeding their principal is refused: remote data
 * does not get to break an invariant the local domain enforces.
 */
function validateDebtInvariants(
  items: readonly PlannedItem[],
  decoded: Map<string, DecodedEntry>,
  context: LocalContext,
): { index: number; failure: PullFailure } | undefined {
  const supersededBySyncId = new Set(
    items.filter((item) => item.entityType === 'transaction').map((item) => item.syncId),
  );

  // A record this batch rewrites or hides is counted from the batch instead.
  const existing = context.localDebtRows
    .filter((row) => !supersededBySyncId.has(row.syncId))
    .map((row) => ({
      personSyncId: row.personSyncId,
      type: row.type as DebtType,
      amountMinor: row.amountMinor,
      currency: row.currency,
    }));

  // In server order, so a principal is counted before the repayment that
  // depends on it.
  const incoming: DebtContribution<DecodedEntry>[] = [...decoded.values()]
    .filter((entry) => entry.change.entityType === 'transaction')
    .map((entry) => ({ entry, row: entry.row as PulledTransactionRow }))
    .filter(({ row }) => row.deleted_at === null && isDebtType(row.type))
    .filter(({ row }) => row.person_sync_id !== null)
    .sort((left, right) => left.entry.index - right.entry.index)
    .map(({ entry, row }) => ({
      key: entry,
      personSyncId: row.person_sync_id!,
      type: row.type as DebtType,
      amountMinor: row.amount_minor,
      currency: row.currency,
    }));

  const violation = findDebtViolation(existing, incoming);
  if (violation === undefined) return undefined;
  return {
    index: violation.key.index,
    failure: failureFor(violation.key.change, 'domain_invariant', violation.problem),
  };
}

/**
 * Dependency-safe order.
 *
 * Parents before children, and children's tombstones before their parents'. A
 * transaction never reaches SQLite before the account, category or person it
 * points at, and a parent is never hidden while a live child still needs it.
 */
const PHASE_ORDER: Record<string, number> = {
  'settings:row': 0,
  'account:row': 1,
  'category:row': 1,
  'person:row': 1,
  'budget:row': 2,
  'transaction:row': 2,
  'budget:tombstone': 3,
  'transaction:tombstone': 3,
  'settings:tombstone': 4,
  'account:tombstone': 4,
  'category:tombstone': 4,
  'person:tombstone': 4,
};

function orderByDependency(items: PlannedItem[]): PlannedItem[] {
  return [...items].sort(
    (left, right) => phaseOf(left) - phaseOf(right) || left.sequence - right.sequence,
  );
}

function phaseOf(item: PlannedItem): number {
  return PHASE_ORDER[`${item.entityType}:${item.remoteDeleted ? 'tombstone' : 'row'}`] ?? 2;
}

function readPendingFor(entityType: SyncEntityType, syncId: string): PendingEntry | undefined {
  return readPendingSyncMutations(entityType, [syncId]).get(syncId);
}
