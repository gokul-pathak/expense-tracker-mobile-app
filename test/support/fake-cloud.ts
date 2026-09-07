import type { SyncEntityType } from '@/db/schema';
import { REMOTE_TABLES, type RemoteRow } from '@/features/sync/remote/remote-rows';
import {
  PushRemoteError,
  type RemoteSyncRepository,
} from '@/features/sync/remote/supabase-sync.repository';

/**
 * In-memory stand-in for the cloud, so the whole push engine is testable with
 * no Supabase, no network and no Docker.
 *
 * It reproduces the two cloud behaviours push depends on: upserts are keyed by
 * the same unique identity the real tables use, so replaying an operation
 * converges on one row; and rows owned by another user are rejected the way row
 * level security rejects them.
 */

export type UpsertCall = { entityType: SyncEntityType; rows: RemoteRow[] };

export type FailureRule = (call: UpsertCall) => PushRemoteError | undefined;

export type FakeCloud = {
  repository: RemoteSyncRepository;
  calls: UpsertCall[];
  rows: (entityType: SyncEntityType) => RemoteRow[];
  rowBySyncId: (entityType: SyncEntityType, syncId: string) => RemoteRow | undefined;
  failWith: (rule: FailureRule | null) => void;
  /** Rejects any row not owned by this user, as the RLS policy does. */
  enforceOwner: (userId: string | null) => void;
  reset: () => void;
};

export function createFakeCloud(): FakeCloud {
  const calls: UpsertCall[] = [];
  const tables = new Map<SyncEntityType, Map<string, RemoteRow>>();
  let failureRule: FailureRule | null = null;
  let owner: string | null = null;

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

      const table = tables.get(entityType) ?? new Map<string, RemoteRow>();
      for (const row of rows) table.set(identityOf(entityType, row), row);
      tables.set(entityType, table);
    },
  };

  return {
    repository,
    calls,
    rows: (entityType) => [...(tables.get(entityType)?.values() ?? [])],
    rowBySyncId: (entityType, syncId) =>
      [...(tables.get(entityType)?.values() ?? [])].find(
        (row) => readField(row, 'sync_id') === syncId,
      ),
    failWith: (rule) => {
      failureRule = rule;
    },
    enforceOwner: (userId) => {
      owner = userId;
    },
    reset: () => {
      calls.length = 0;
      tables.clear();
      failureRule = null;
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

function identityOf(entityType: SyncEntityType, row: RemoteRow): string {
  return String(readField(row, REMOTE_TABLES[entityType].onConflict));
}

function readField(row: RemoteRow, field: string): unknown {
  return (row as unknown as Record<string, unknown>)[field];
}
