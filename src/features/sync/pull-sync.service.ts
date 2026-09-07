import { db } from '@/db';
import { PULL_CURSOR_START, type SyncEntityType } from '@/db/schema';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';

import {
  planPullBatch,
  type OutboxOperation,
  type PlannedItem,
  type PlannedWrite,
} from './pull-plan';
import {
  emptyPullResult,
  isRequestScopedPullError,
  type PullConflictOutcome,
  type PullFailure,
  type PullStatus,
  type PullSyncResult,
} from './pull-sync.types';
import { decodeRemoteChange, type RemoteChange } from './remote/remote-pull-rows';
import {
  createSupabasePullRepository,
  PullRemoteError,
  type RemotePullRepository,
} from './remote/supabase-sync.repository';
import {
  applyRemoteAccount,
  applyRemoteCategory,
  applyRemotePerson,
  applyRemoteSettings,
  applyRemoteTombstone,
  applyRemoteTransaction,
  rebindRemoteCategoryIdentity,
  rebindRemoteSettingsIdentity,
} from './remote-apply.repository';
import { recordSyncBaseline, recordSyncConflict } from './sync-baseline.repository';
import { isSyncEngineRunning, withSyncEngineLock } from './sync-lock';
import {
  acknowledgeSyncMutation,
  getPendingSyncMutation,
  getSyncState,
  rekeySyncMutation,
  setPendingSyncMutationBase,
  updateSyncState,
} from './sync.repository';
import type { SyncWriter } from './sync.types';

/**
 * Pull Sync.
 *
 * Downloaded changes never reach a screen. They are decoded, checked against the
 * domain rules the app enforces locally, applied to SQLite, and read back by the
 * existing repositories — so every balance, report and receivable stays a
 * calculation over local source records rather than a figure copied from a
 * server.
 *
 * The run is a loop of bounded batches:
 *
 *   read changes after the cursor -> validate -> resolve conflicts ->
 *   apply and move the cursor in one transaction -> repeat until caught up
 *
 * The cursor moves in the same SQLite transaction as the rows it accounts for.
 * A crash can therefore leave the device behind, never ahead: re-reading a
 * change that was already applied converges on the same state, while a cursor
 * that ran ahead of its data would lose records permanently.
 *
 * Pull issues no cloud writes at all. A conflict the local side wins stays a
 * queued local mutation for a later push, which keeps the two engines
 * composable instead of entangling them.
 */

/** Changes downloaded per request. Bounded so history cannot arrive in one gulp. */
export const PULL_BATCH_SIZE = 100;

/**
 * Upper bound on batches per invocation. Without it a device receiving
 * continuous remote edits could keep one pull run alive indefinitely.
 */
export const PULL_MAX_BATCHES_PER_RUN = 20;

export type PullSyncDependencies = {
  /** Trusted identity for ownership checks. Downloaded data never chooses it. */
  getAuthenticatedUserId: () => Promise<string | null>;
  /** Returns null when this build has no Supabase configuration. */
  createRemote: () => RemotePullRepository | null;
};

export type PullSyncOptions = {
  dependencies?: Partial<PullSyncDependencies>;
  batchSize?: number;
  maxBatches?: number;
};

export function isPullRunning(): boolean {
  return isSyncEngineRunning('pull');
}

/**
 * Concurrent runs are prevented by the shared engine lock, so a pull cannot
 * interleave with a push over the same queue entries. Durable correctness comes
 * from the cursor and idempotent application, not from a flag that a restart
 * would clear.
 */
export async function pullRemoteChanges(options: PullSyncOptions = {}): Promise<PullSyncResult> {
  return withSyncEngineLock(
    'pull',
    () => runPull(options),
    () => emptyPullResult('pulling', currentCursor()),
  );
}

async function runPull(options: PullSyncOptions): Promise<PullSyncResult> {
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const batchSize = options.batchSize ?? PULL_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? PULL_MAX_BATCHES_PER_RUN;

  const remote = dependencies.createRemote();
  if (remote === null) return emptyPullResult('unavailable', currentCursor());

  // A session that cannot be read is a reason to stop, never a reason to fail
  // the caller: the local app stays usable and the cursor stays where it is.
  const userId = await dependencies.getAuthenticatedUserId().catch(() => null);
  if (userId === null) return emptyPullResult('auth_required', currentCursor());

  // Being signed in is not the same as this database belonging to that account.
  // Without an explicit link, downloading cloud rows would pour one account's
  // financial history into whatever local database happened to be open.
  const state = getSyncState();
  const linkedUserId = state?.linkedUserId ?? null;
  if (linkedUserId === null) return emptyPullResult('not_linked', currentCursor());
  if (linkedUserId !== userId) return emptyPullResult('account_mismatch', currentCursor());

  const run: RunState = {
    cursor: state?.pullCursor ?? PULL_CURSOR_START,
    received: 0,
    applied: 0,
    conflicted: 0,
    deleted: 0,
    batches: 0,
    cursorAdvanced: false,
    conflicts: [],
    failures: [],
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const outcome = await pullOneBatch(remote, linkedUserId, batchSize, run);
    if (outcome === 'stop') break;
    if (outcome === 'caught_up') break;
  }

  const status = resolveStatus(run);
  recordRunOutcome(status, run);
  return {
    status,
    received: run.received,
    applied: run.applied,
    conflicted: run.conflicted,
    deleted: run.deleted,
    failed: run.failures.length,
    cursorAdvanced: run.cursorAdvanced,
    cursor: run.cursor,
    batches: run.batches,
    conflicts: run.conflicts,
    failures: run.failures,
  };
}

type RunState = {
  cursor: number;
  received: number;
  applied: number;
  conflicted: number;
  deleted: number;
  batches: number;
  cursorAdvanced: boolean;
  conflicts: PullConflictOutcome[];
  failures: PullFailure[];
};

type BatchOutcome = 'continue' | 'caught_up' | 'stop';

async function pullOneBatch(
  remote: RemotePullRepository,
  linkedUserId: string,
  batchSize: number,
  run: RunState,
): Promise<BatchOutcome> {
  let rawChanges: unknown[];
  try {
    rawChanges = await remote.fetchChanges({ afterSequence: run.cursor, limit: batchSize });
  } catch (error) {
    run.failures.push(requestFailure(error));
    return 'stop';
  }

  run.batches += 1;
  run.received += rawChanges.length;
  if (rawChanges.length === 0) return 'caught_up';

  const decoded = decodeChanges(rawChanges, linkedUserId);
  if (decoded.failure !== undefined) run.failures.push(decoded.failure);
  if (decoded.changes.length === 0) return 'stop';

  let rows: Map<SyncEntityType, Map<string, unknown>>;
  try {
    rows = await fetchRowsForChanges(remote, decoded.changes);
  } catch (error) {
    run.failures.push(requestFailure(error));
    return 'stop';
  }

  const plan = planPullBatch({ changes: decoded.changes, rows, linkedUserId });
  if (plan.stoppedAt !== undefined) run.failures.push(plan.stoppedAt.failure);
  if (plan.coveredChanges === 0) return 'stop';

  const cursorAfter = decoded.changes[plan.coveredChanges - 1]!.sequence;
  try {
    const committed = applyPlan(plan.items, cursorAfter);
    run.applied += committed.applied;
    run.deleted += committed.deleted;
    run.conflicts.push(...committed.conflicts);
    run.conflicted += committed.conflicts.length;
    run.cursor = cursorAfter;
    run.cursorAdvanced = true;
  } catch (error) {
    // The transaction rolled back: no domain row changed and the cursor still
    // points at the last position this device can prove it applied.
    run.failures.push({
      entityType: plan.items[0]?.entityType ?? 'transaction',
      code: 'apply_failed',
      detail: error instanceof Error ? error.name : 'unknown',
    });
    return 'stop';
  }

  if (plan.stoppedAt !== undefined || decoded.failure !== undefined) return 'stop';
  // A short page means the change feed is exhausted for now. A row appended
  // after this read simply arrives on the next run, from this cursor.
  return rawChanges.length < batchSize ? 'caught_up' : 'continue';
}

type DecodedChanges = { changes: RemoteChange[]; failure?: PullFailure };

/**
 * Decodes the change feed, stopping at the first row that cannot be trusted.
 *
 * Truncating rather than skipping is deliberate: the cursor may only advance
 * over changes that were actually applied.
 */
function decodeChanges(rawChanges: readonly unknown[], linkedUserId: string): DecodedChanges {
  const changes: RemoteChange[] = [];
  for (const raw of rawChanges) {
    const parsed = decodeRemoteChange(raw);
    if (!parsed.ok) {
      return {
        changes,
        failure: { entityType: 'transaction', code: 'invalid_remote_data', detail: parsed.issue },
      };
    }
    if (parsed.change.userId !== linkedUserId) {
      return {
        changes,
        failure: {
          entityType: parsed.change.entityType,
          entitySyncId: parsed.change.entitySyncId,
          sequence: parsed.change.sequence,
          code: 'foreign_owner',
        },
      };
    }
    changes.push(parsed.change);
  }
  return { changes };
}

/** One query per entity type for the whole batch, never one per record. */
async function fetchRowsForChanges(
  remote: RemotePullRepository,
  changes: readonly RemoteChange[],
): Promise<Map<SyncEntityType, Map<string, unknown>>> {
  const identifiersByType = new Map<SyncEntityType, Set<string>>();
  for (const change of changes) {
    const set = identifiersByType.get(change.entityType) ?? new Set<string>();
    set.add(change.entitySyncId);
    identifiersByType.set(change.entityType, set);
  }

  const rows = new Map<SyncEntityType, Map<string, unknown>>();
  for (const [entityType, syncIds] of identifiersByType) {
    const fetched = await remote.fetchRows(entityType, [...syncIds]);
    const byIdentity = new Map<string, unknown>();
    for (const row of fetched) {
      const syncId = (row as { sync_id?: unknown }).sync_id;
      if (typeof syncId === 'string') byIdentity.set(syncId, row);
    }
    rows.set(entityType, byIdentity);
  }
  return rows;
}

type CommitResult = { applied: number; deleted: number; conflicts: PullConflictOutcome[] };

/**
 * Applies one planned prefix and moves the cursor, atomically.
 *
 * Nothing here can leave the device with data it has forgotten it applied, or a
 * cursor past data it never applied: both are the same transaction.
 */
function applyPlan(items: readonly PlannedItem[], cursorAfter: number): CommitResult {
  return db.transaction((tx) => {
    const result: CommitResult = { applied: 0, deleted: 0, conflicts: [] };

    for (const item of items) {
      if (supersededByLocalMutation(item, tx)) {
        // The record changed locally between planning and committing. The local
        // edit is newer than the remote revision this run read, so it wins by
        // the same rule a conflict detected up front would have applied.
        const conflict = handleLocalMutationDuringPull(item, tx);
        result.conflicts.push(conflict);
        continue;
      }

      if (item.identityRebind !== undefined) applyWrite(item.identityRebind, tx);
      for (const write of item.writes) applyWrite(write, tx);
      for (const operation of item.outbox) applyOutboxOperation(operation, tx);

      recordSyncBaseline(
        {
          entityType: item.entityType,
          entitySyncId: item.syncId,
          serverRevision: item.serverRevision,
          deleted: item.remoteDeleted,
        },
        tx,
      );

      if (item.audit !== undefined) recordSyncConflict(toConflictRecord(item.audit), tx);
      if (item.conflict !== undefined) {
        recordSyncConflict(toConflictRecord(item.conflict), tx);
        result.conflicts.push(item.conflict);
      }
      result.applied += item.counts.applied;
      result.deleted += item.counts.deleted;
    }

    updateSyncState({ pullCursor: cursorAfter }, tx);
    return result;
  });
}

/**
 * Whether a local mutation appeared or advanced since this item was planned.
 *
 * This is the same protection push uses at acknowledgement: work is only acted
 * on while it still matches what was inspected. Tombstones are exempt, because a
 * delete wins over a concurrent edit by policy.
 */
function supersededByLocalMutation(item: PlannedItem, writer: SyncWriter): boolean {
  if (!item.guardAgainstLocalMutation) return false;
  const current =
    getPendingSyncMutation(item.entityType, item.syncId, writer) ??
    getPendingSyncMutation(item.entityType, item.pendingLookupSyncId, writer);
  if (current === null) return false;
  const observed = item.observedPending;
  return observed === null || current.id !== observed.id || current.revision !== observed.revision;
}

function handleLocalMutationDuringPull(item: PlannedItem, writer: SyncWriter): PullConflictOutcome {
  // Identity is shared state rather than a value either side owns, so a rebind
  // still applies; the local change keeps the record's values.
  if (item.identityRebind !== undefined) {
    applyWrite(item.identityRebind, writer);
    for (const operation of item.outbox) {
      if (operation.op === 'rekey') applyOutboxOperation(operation, writer);
    }
  }

  const current =
    getPendingSyncMutation(item.entityType, item.syncId, writer) ??
    getPendingSyncMutation(item.entityType, item.pendingLookupSyncId, writer);
  if (current !== null) {
    setPendingSyncMutationBase(current.id, current.revision, item.serverRevision, writer);
  }

  recordSyncBaseline(
    {
      entityType: item.entityType,
      entitySyncId: item.syncId,
      serverRevision: item.serverRevision,
      deleted: false,
    },
    writer,
  );

  const conflict: PullConflictOutcome = {
    entityType: item.entityType,
    entitySyncId: item.syncId,
    localOperation: current?.operation ?? null,
    resolution: current?.operation === 'delete' ? 'local_delete_wins' : 'local_wins',
    remoteServerRevision: item.serverRevision,
    baseServerRevision: item.conflict?.baseServerRevision ?? null,
    detail: 'mutation_during_pull',
  };
  recordSyncConflict(toConflictRecord(conflict), writer);
  return conflict;
}

function applyWrite(write: PlannedWrite, writer: SyncWriter): void {
  switch (write.write) {
    case 'account':
      applyRemoteAccount(write.row, writer);
      return;
    case 'category':
      applyRemoteCategory(write.row, writer);
      return;
    case 'person':
      applyRemotePerson(write.row, writer);
      return;
    case 'settings':
      applyRemoteSettings(write.row, writer);
      return;
    case 'transaction':
      applyRemoteTransaction(write.row, writer);
      return;
    case 'tombstone':
      applyRemoteTombstone(
        { entityType: write.entityType, syncId: write.syncId, deletedAt: write.deletedAt },
        writer,
      );
      return;
    case 'rebind-category':
      rebindRemoteCategoryIdentity(write.systemKey, write.syncId, writer);
      return;
    case 'rebind-settings':
      rebindRemoteSettingsIdentity(write.syncId, writer);
      return;
  }
}

function applyOutboxOperation(operation: OutboxOperation, writer: SyncWriter): void {
  switch (operation.op) {
    case 'remove':
      // Revision-guarded: an edit made while this pull was running keeps its
      // queue entry and will still be pushed.
      acknowledgeSyncMutation(operation.id, operation.revision, writer);
      return;
    case 'rebase':
      setPendingSyncMutationBase(operation.id, operation.revision, operation.base, writer);
      return;
    case 'rekey':
      rekeySyncMutation(operation.entityType, operation.from, operation.to, writer);
      return;
  }
}

function toConflictRecord(conflict: PullConflictOutcome) {
  return {
    entityType: conflict.entityType,
    entitySyncId: conflict.entitySyncId,
    localOperation: conflict.localOperation,
    baseServerRevision: conflict.baseServerRevision,
    remoteServerRevision: conflict.remoteServerRevision,
    resolution: conflict.resolution,
    detail: conflict.detail ?? null,
    detectedAt: new Date(),
  };
}

function requestFailure(error: unknown): PullFailure {
  const remoteError =
    error instanceof PullRemoteError ? error : new PullRemoteError('remote_unknown');
  return {
    entityType: 'transaction',
    code: remoteError.code,
    ...(remoteError.detail === undefined ? {} : { detail: remoteError.detail }),
  };
}

function resolveStatus(run: RunState): PullStatus {
  const requestScoped = run.failures.find((failure) => isRequestScopedPullError(failure.code));
  if (requestScoped !== undefined) {
    if (requestScoped.code === 'network') return 'offline';
    if (requestScoped.code === 'auth') return 'auth_required';
    if (requestScoped.code === 'account_mismatch') return 'account_mismatch';
    return 'error';
  }
  if (run.failures.some((failure) => failure.code === 'apply_failed')) return 'error';
  if (run.failures.length > 0) {
    // A record the engine cannot safely apply is not a crash and not a silent
    // skip: the cursor stops before it and a person has to look.
    return 'attention_required';
  }
  if (run.conflicts.length > 0) return 'conflict';
  return run.applied === 0 && run.deleted === 0 ? 'idle' : 'success';
}

/**
 * Records pull progress only. This is deliberately not a "last synced" marker:
 * pending local work may still be waiting for a push, and orchestrating both is
 * M7F's job.
 */
function recordRunOutcome(status: PullStatus, run: RunState) {
  if (status === 'success' || status === 'idle' || status === 'conflict') {
    updateSyncState({ lastSuccessfulPullAt: new Date(), lastSyncError: null });
    return;
  }
  const first = run.failures[0];
  if (first !== undefined) updateSyncState({ lastSyncError: first.code });
}

function currentCursor(): number | null {
  return getSyncState()?.pullCursor ?? null;
}

function defaultDependencies(): PullSyncDependencies {
  return {
    // Session lifetime and refresh belong to the auth layer; pull only reads it.
    getAuthenticatedUserId: async () => {
      try {
        const session = await cloudAuthService.getSession();
        return session?.user.id ?? null;
      } catch {
        return null;
      }
    },
    createRemote: () => createSupabasePullRepository(),
  };
}
