import type { SyncEntityType, SyncOperation } from '@/db/schema';

import {
  mapPulledAccountToLocal,
  mapPulledCategoryToLocal,
  mapPulledPersonToLocal,
  mapPulledSettingsToLocal,
  mapPulledTransactionToLocal,
} from './mapping/remote-to-local';
import type { PullConflictOutcome, PullFailure } from './pull-sync.types';
import {
  decodePulledRow,
  type PulledAccountRow,
  type PulledCategoryRow,
  type PulledPersonRow,
  type PulledRow,
  type PulledSettingsRow,
  type PulledTransactionRow,
  type RemoteChange,
} from './remote/remote-pull-rows';
import type {
  RemoteAccount,
  RemoteCategory,
  RemotePerson,
  RemoteSettings,
  RemoteTransaction,
} from './remote-apply.repository';
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

/** Types the cloud schema permits but this app has no domain support for. */
const UNSUPPORTED_TRANSACTION_TYPES: readonly string[] = ['investment', 'investment_return'];

const DEBT_TYPES = ['lend', 'borrow', 'repayment_received', 'repayment_paid'] as const;

type DebtType = (typeof DEBT_TYPES)[number];

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
      // The change feed named a row the query did not return. Skipping it would
      // hide a real record behind an advancing cursor, so the run stops here.
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
  accounts: Map<string, { currency: string; isArchived: boolean }>;
  categoryTypes: Map<string, string>;
  people: Set<string>;
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

  const accounts = new Map<string, { currency: string; isArchived: boolean }>();
  const categoryTypes = new Map<string, string>();
  const people = new Set<string>();

  // Local parents first, so a parent that only exists locally still resolves.
  for (const [syncId, row] of readAccountCurrenciesBySyncId(referencedAccounts)) {
    accounts.set(syncId, row);
  }
  for (const [syncId, type] of readCategoryTypesBySyncId(referencedCategories)) {
    categoryTypes.set(syncId, type);
  }
  for (const syncId of readLocalRowsBySyncIds('person', referencedPeople).keys()) {
    people.add(syncId);
  }

  // Then the batch's own parents, which are applied before their children and
  // therefore describe the state the children will see.
  for (const entry of decoded.values()) {
    if (entry.row.deleted_at !== null) continue;
    switch (entry.change.entityType) {
      case 'account': {
        const row = entry.row as PulledAccountRow;
        accounts.set(row.sync_id, { currency: row.currency, isArchived: row.is_archived });
        break;
      }
      case 'category': {
        const row = entry.row as PulledCategoryRow;
        categoryTypes.set(row.sync_id, row.type);
        break;
      }
      case 'person':
        people.add(entry.row.sync_id);
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
    accounts,
    categoryTypes,
    people,
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
    const problem = validateTransaction(row as PulledTransactionRow, context, remoteDeleted);
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

type TransactionProblem = {
  code: 'invalid_remote_data' | 'unknown_parent' | 'unsupported_remote_data';
  detail: string;
};

/**
 * Domain invariants for one downloaded transaction.
 *
 * The cloud enforces shape, but a client cannot delegate meaning: category type
 * compatibility, transfer account difference, currency agreement and relation
 * existence are all checked again before anything reaches SQLite.
 */
function validateTransaction(
  row: PulledTransactionRow,
  context: LocalContext,
  remoteDeleted: boolean,
): TransactionProblem | undefined {
  if (UNSUPPORTED_TRANSACTION_TYPES.includes(row.type)) {
    return { code: 'unsupported_remote_data', detail: `type:${row.type}` };
  }
  // A deleted record is invisible to every domain calculation, so its shape
  // cannot corrupt anything and is not re-litigated here.
  if (remoteDeleted) return undefined;

  const source = row.source_account_sync_id;
  const destination = row.destination_account_sync_id;
  const category = row.category_sync_id;
  const person = row.person_sync_id;

  const shape = validateShape(row.type, { source, destination, category, person });
  if (shape !== undefined) return shape;

  if (category !== null) {
    const type = context.categoryTypes.get(category);
    if (type === undefined) return { code: 'unknown_parent', detail: 'category' };
    const required = row.type === 'expense' ? 'expense' : 'income';
    if (type !== required) return { code: 'invalid_remote_data', detail: 'category_type' };
  }

  for (const accountSyncId of [source, destination]) {
    if (accountSyncId === null) continue;
    const account = context.accounts.get(accountSyncId);
    // A missing parent is never resolved by writing a null foreign key: that
    // would silently change what the record means.
    if (account === undefined) return { code: 'unknown_parent', detail: 'account' };
    if (account.currency !== row.currency) {
      return { code: 'invalid_remote_data', detail: 'account_currency' };
    }
  }

  if (person !== null && !context.people.has(person)) {
    return { code: 'unknown_parent', detail: 'person' };
  }

  return undefined;
}

function validateShape(
  type: PulledTransactionRow['type'],
  relations: {
    source: string | null;
    destination: string | null;
    category: string | null;
    person: string | null;
  },
): TransactionProblem | undefined {
  const { source, destination, category, person } = relations;
  const invalid = (detail: string): TransactionProblem => ({
    code: 'invalid_remote_data',
    detail,
  });

  switch (type) {
    case 'expense':
      if (source === null || destination !== null) return invalid('expense_accounts');
      if (category === null || person !== null) return invalid('expense_relations');
      return undefined;
    case 'income':
      if (destination === null || source !== null) return invalid('income_accounts');
      if (category === null || person !== null) return invalid('income_relations');
      return undefined;
    case 'transfer':
      if (source === null || destination === null) return invalid('transfer_accounts');
      if (source === destination) return invalid('transfer_same_account');
      if (category !== null || person !== null) return invalid('transfer_relations');
      return undefined;
    case 'lend':
    case 'repayment_paid':
      if (source === null || destination !== null) return invalid('debt_accounts');
      if (person === null || category !== null) return invalid('debt_relations');
      return undefined;
    case 'borrow':
    case 'repayment_received':
      if (destination === null || source !== null) return invalid('debt_accounts');
      if (person === null || category !== null) return invalid('debt_relations');
      return undefined;
    default:
      return { code: 'unsupported_remote_data', detail: `type:${type}` };
  }
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
  type Totals = Record<DebtType, number>;
  const empty = (): Totals => ({ lend: 0, borrow: 0, repayment_received: 0, repayment_paid: 0 });

  const supersededBySyncId = new Set(
    items.filter((item) => item.entityType === 'transaction').map((item) => item.syncId),
  );
  const totals = new Map<string, Totals>();
  const currencies = new Map<string, Set<string>>();

  const contribute = (personSyncId: string, type: DebtType, amount: number, currency: string) => {
    const bucket = totals.get(personSyncId) ?? empty();
    bucket[type] += amount;
    totals.set(personSyncId, bucket);
    const seen = currencies.get(personSyncId) ?? new Set<string>();
    seen.add(currency);
    currencies.set(personSyncId, seen);
  };

  for (const row of context.localDebtRows) {
    // A record this batch rewrites or hides is counted from the batch instead.
    if (supersededBySyncId.has(row.syncId)) continue;
    contribute(row.personSyncId, row.type as DebtType, row.amountMinor, row.currency);
  }

  // In server order, so a principal is counted before the repayment that
  // depends on it and blame for a violation lands on the record that caused it.
  const contributors = [...decoded.values()]
    .filter((entry) => entry.change.entityType === 'transaction')
    .filter((entry) => (entry.row as PulledTransactionRow).deleted_at === null)
    .filter((entry) => DEBT_TYPES.includes((entry.row as PulledTransactionRow).type as DebtType))
    .sort((left, right) => left.index - right.index);

  for (const entry of contributors) {
    const row = entry.row as PulledTransactionRow;
    const personSyncId = row.person_sync_id;
    if (personSyncId === null) continue;

    contribute(personSyncId, row.type as DebtType, row.amount_minor, row.currency);

    const bucket = totals.get(personSyncId)!;
    const problem =
      bucket.repayment_received > bucket.lend
        ? 'repayment_received_exceeds_lent'
        : bucket.repayment_paid > bucket.borrow
          ? 'repayment_paid_exceeds_borrowed'
          : (currencies.get(personSyncId)?.size ?? 0) > 1
            ? 'mixed_person_currency'
            : undefined;
    if (problem === undefined) continue;

    return { index: entry.index, failure: failureFor(entry.change, 'domain_invariant', problem) };
  }

  return undefined;
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
  'transaction:row': 2,
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
