import type { SyncEntityType } from '@/db/schema';
import { REMOTE_TABLES, type RemoteRow } from '@/features/sync/remote/remote-rows';
import {
  PullRemoteError,
  PushRemoteError,
  type RemotePullRepository,
  type RemoteSnapshotRepository,
  type RemoteSyncRepository,
} from '@/features/sync/remote/supabase-sync.repository';

/**
 * In-memory stand-in for the cloud, so the whole sync engine is testable with no
 * Supabase, no network and no Docker.
 *
 * It reproduces the cloud behaviours the engines depend on:
 *
 * - upserts are keyed by the same unique identity the real tables use, so
 *   replaying an operation converges on one row instead of duplicating it;
 * - rows owned by another user are rejected the way the RLS policy rejects them;
 * - `sync.record_change()` assigns a `server_revision` per row and appends to a
 *   single monotonic `sync_changes` sequence, which is the pull cursor.
 *
 * The trigger quirk documented in `docs/sync-m7d.md` is reproduced too: because
 * it is a BEFORE trigger, a conflicting upsert appends a spurious revision-1
 * change before the real one. Pull has to tolerate that, so the fake produces it.
 */

export type UpsertCall = { entityType: SyncEntityType; rows: RemoteRow[] };

export type FailureRule = (call: UpsertCall) => PushRemoteError | undefined;

export type PullCall = { kind: 'changes' | 'rows'; entityType?: SyncEntityType };

export type PullFailureRule = (call: PullCall) => PullRemoteError | undefined;

type StoredRow = { row: Record<string, unknown>; revision: number; updatedAt: string };

type StoredChange = {
  sequence: number;
  user_id: string;
  entity_type: string;
  entity_sync_id: string;
  server_revision: number;
};

export type FakeCloud = {
  repository: RemoteSyncRepository;
  pullRepository: RemotePullRepository;
  snapshotRepository: RemoteSnapshotRepository;
  calls: UpsertCall[];
  pullCalls: PullCall[];
  rows: (entityType: SyncEntityType) => RemoteRow[];
  rowBySyncId: (entityType: SyncEntityType, syncId: string) => RemoteRow | undefined;
  /** Writes a row the way another device would, assigning a revision and a change. */
  putRow: (entityType: SyncEntityType, row: Record<string, unknown>) => void;
  /** Marks a row deleted remotely, exactly as an uploaded tombstone would. */
  deleteRow: (entityType: SyncEntityType, syncId: string, deletedAt?: number) => void;
  changes: () => StoredChange[];
  revisionOf: (entityType: SyncEntityType, syncId: string) => number | undefined;
  failWith: (rule: FailureRule | null) => void;
  /**
   * Fails after the rows were written, standing in for a crash between a
   * successful cloud write and the local acknowledgement.
   */
  failAfterWriteWith: (rule: FailureRule | null) => void;
  failPullWith: (rule: PullFailureRule | null) => void;
  /** Rejects any row not owned by this user, as the RLS policy does. */
  enforceOwner: (userId: string | null) => void;
  reset: () => void;
};

export function createFakeCloud(): FakeCloud {
  const calls: UpsertCall[] = [];
  const pullCalls: PullCall[] = [];
  // The uploaded payload and the server-generated metadata are kept apart, so a
  // test can assert the exact contract push sends without server columns in it.
  const tables = new Map<SyncEntityType, Map<string, StoredRow>>();
  const changeLog: StoredChange[] = [];
  let sequence = 0;
  let failureRule: FailureRule | null = null;
  let afterWriteFailureRule: FailureRule | null = null;
  let pullFailureRule: PullFailureRule | null = null;
  let owner: string | null = null;

  function recordChange(
    entityType: SyncEntityType,
    row: Record<string, unknown>,
    revision: number,
  ) {
    sequence += 1;
    changeLog.push({
      sequence,
      user_id: String(row.user_id),
      entity_type: REMOTE_TABLES[entityType].table,
      entity_sync_id: String(row.sync_id),
      server_revision: revision,
    });
  }

  function write(entityType: SyncEntityType, received: Record<string, unknown>) {
    const table = tables.get(entityType) ?? new Map<string, StoredRow>();
    const identity = String(received[REMOTE_TABLES[entityType].onConflict]);
    const existing = table.get(identity);
    // `sync.guard_recurring_occurrence()`: a generated occurrence is never turned
    // back into a skipped one, in whichever order two devices' uploads arrive.
    const incoming =
      entityType === 'recurring_occurrence' &&
      existing !== undefined &&
      existing.row.status === 'generated' &&
      received.status !== 'generated'
        ? { ...received, status: 'generated' }
        : received;

    if (existing !== undefined) {
      // The BEFORE INSERT branch fires before the conflict is detected, so the
      // real database appends a change here that it then supersedes.
      recordChange(entityType, incoming, 1);
    }
    const revision = existing === undefined ? 1 : existing.revision + 1;
    table.set(identity, { row: { ...incoming }, revision, updatedAt: nowIso() });
    tables.set(entityType, table);
    recordChange(entityType, incoming, revision);
  }

  function storedRows(entityType: SyncEntityType): StoredRow[] {
    return [...(tables.get(entityType)?.values() ?? [])];
  }

  function findStored(entityType: SyncEntityType, syncId: string): StoredRow | undefined {
    return storedRows(entityType).find((stored) => stored.row.sync_id === syncId);
  }

  const repository: RemoteSyncRepository = {
    async upsert(entityType, rows) {
      const call = { entityType, rows };
      calls.push(call);

      const injected = failureRule?.(call);
      if (injected !== undefined) throw injected;

      if (owner !== null) {
        for (const row of rows) {
          if (readField(row, 'user_id') !== owner) {
            throw new PushRemoteError('authorization', '42501');
          }
        }
      }

      // An identity already owned by someone else cannot be written over. The
      // real database refuses this through row level security: the existing row
      // is invisible to this caller, so the conflicting upsert cannot update it.
      for (const row of rows) {
        const existing = findStored(entityType, String(readField(row, 'sync_id')));
        if (existing !== undefined && existing.row.user_id !== readField(row, 'user_id')) {
          throw new PushRemoteError('authorization', '42501');
        }
      }

      for (const row of rows) write(entityType, { ...(row as Record<string, unknown>) });

      const afterWrite = afterWriteFailureRule?.(call);
      if (afterWrite !== undefined) throw afterWrite;
    },
  };

  const pullRepository: RemotePullRepository = {
    async fetchChanges({ afterSequence, limit }) {
      const call: PullCall = { kind: 'changes' };
      pullCalls.push(call);
      const injected = pullFailureRule?.(call);
      if (injected !== undefined) throw injected;

      return changeLog
        .filter((change) => change.sequence > afterSequence)
        .filter((change) => owner === null || change.user_id === owner)
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit)
        .map((change) => ({ ...change }));
    },

    async fetchRows(entityType, syncIds) {
      const call: PullCall = { kind: 'rows', entityType };
      pullCalls.push(call);
      const injected = pullFailureRule?.(call);
      if (injected !== undefined) throw injected;

      const wanted = new Set(syncIds);
      return storedRows(entityType)
        .filter((stored) => wanted.has(String(stored.row.sync_id)))
        .filter((stored) => owner === null || stored.row.user_id === owner)
        .map((stored) => ({
          ...stored.row,
          server_revision: stored.revision,
          server_updated_at: stored.updatedAt,
        }));
    },
  };

  const snapshotRepository: RemoteSnapshotRepository = {
    async fetchRowPage(entityType, { afterSyncId, limit }) {
      const call: PullCall = { kind: 'rows', entityType };
      pullCalls.push(call);
      const injected = pullFailureRule?.(call);
      if (injected !== undefined) throw injected;

      const rows: Record<string, unknown>[] = storedRows(entityType)
        .filter((stored) => owner === null || stored.row.user_id === owner)
        .map((stored) => ({
          ...stored.row,
          server_revision: stored.revision,
          server_updated_at: stored.updatedAt,
        }));
      return (
        rows
          // Identity order, exactly as the real query pages.
          .sort((left, right) => String(left.sync_id).localeCompare(String(right.sync_id)))
          .filter((row) => afterSyncId === null || String(row.sync_id) > afterSyncId)
          .slice(0, limit)
      );
    },

    async fetchLatestSequence() {
      const call: PullCall = { kind: 'changes' };
      pullCalls.push(call);
      const injected = pullFailureRule?.(call);
      if (injected !== undefined) throw injected;

      return changeLog
        .filter((change) => owner === null || change.user_id === owner)
        .reduce((highest, change) => Math.max(highest, change.sequence), 0);
    },
  };

  return {
    repository,
    pullRepository,
    snapshotRepository,
    calls,
    pullCalls,
    rows: (entityType) => storedRows(entityType).map((stored) => stored.row) as RemoteRow[],
    rowBySyncId: (entityType, syncId) =>
      findStored(entityType, syncId)?.row as RemoteRow | undefined,
    putRow: (entityType, row) => write(entityType, { ...row }),
    deleteRow: (entityType, syncId, deletedAt = Date.now()) => {
      const existing = findStored(entityType, syncId);
      if (existing === undefined) throw new Error(`No cloud ${entityType} ${syncId} to delete.`);
      write(entityType, { ...existing.row, deleted_at: deletedAt });
    },
    changes: () => changeLog.map((change) => ({ ...change })),
    revisionOf: (entityType, syncId) => findStored(entityType, syncId)?.revision,
    failWith: (rule) => {
      failureRule = rule;
    },
    failAfterWriteWith: (rule) => {
      afterWriteFailureRule = rule;
    },
    failPullWith: (rule) => {
      pullFailureRule = rule;
    },
    enforceOwner: (userId) => {
      owner = userId;
    },
    reset: () => {
      calls.length = 0;
      pullCalls.length = 0;
      tables.clear();
      changeLog.length = 0;
      sequence = 0;
      failureRule = null;
      afterWriteFailureRule = null;
      pullFailureRule = null;
      owner = null;
    },
  };
}

/** Fails every call once, then lets the next attempt through. */
export function failOnce(error: PushRemoteError): FailureRule {
  let used = false;
  return () => {
    if (used) return undefined;
    used = true;
    return error;
  };
}

/** The pull equivalent: one failure, then normal service. */
export function failPullOnce(error: PullRemoteError): PullFailureRule {
  let used = false;
  return () => {
    if (used) return undefined;
    used = true;
    return error;
  };
}

export type { StoredChange };

function readField(row: RemoteRow, field: string): unknown {
  return (row as unknown as Record<string, unknown>)[field];
}

function nowIso(): string {
  return new Date().toISOString();
}
