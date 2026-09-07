import type { SupabaseClient } from '@supabase/supabase-js';

import type { SyncEntityType } from '@/db/schema';
import { getSupabaseClient } from '@/lib/supabase/client';

import type { PushErrorCode } from '../push-sync.types';

import { REMOTE_SCHEMA, REMOTE_TABLES, type RemoteRow } from './remote-rows';

/**
 * The only module that knows Supabase exists for financial data.
 *
 * It writes through the authenticated user's session, so every statement runs
 * under row level security. There is no service-role path: an authorization
 * failure is a real failure to surface, never something to bypass.
 *
 * Push writes only. Reading cloud financial data belongs to Pull Sync.
 */

export class PushRemoteError extends Error {
  constructor(
    readonly code: PushErrorCode,
    readonly detail?: string,
  ) {
    // The message carries the classification only, never a row or a response body.
    super(`Cloud push failed: ${code}${detail === undefined ? '' : ` (${detail})`}`);
    this.name = 'PushRemoteError';
  }
}

export type RemoteSyncRepository = {
  /**
   * Idempotent upsert keyed by the cloud table's unique identity, so replaying
   * the same operation converges on one row instead of duplicating it.
   * A deletion is an upsert carrying `deleted_at`, which keeps the tombstone
   * visible to other devices.
   */
  upsert(entityType: SyncEntityType, rows: RemoteRow[]): Promise<void>;
};

export function createSupabaseSyncRepository(
  client: SupabaseClient | null = getSupabaseClient(),
): RemoteSyncRepository | null {
  if (client === null) return null;

  return {
    async upsert(entityType, rows) {
      if (rows.length === 0) return;
      const { table, onConflict } = REMOTE_TABLES[entityType];

      let response;
      try {
        response = await client
          .schema(REMOTE_SCHEMA)
          .from(table)
          // No representation is requested back: the local row is already the
          // intended state, and downloading rows is Pull Sync's job.
          .upsert(rows, { onConflict });
      } catch (error) {
        throw new PushRemoteError(classifyThrownError(error));
      }

      if (response.error !== null) throw toPushRemoteError(response.error);
    },
  };
}

type SupabaseErrorShape = { code?: string | null; message?: string | null };

/** Maps a PostgREST/PostgreSQL failure onto an internal category. */
export function toPushRemoteError(error: SupabaseErrorShape): PushRemoteError {
  const code = error.code?.trim() ?? '';
  const message = error.message?.toLowerCase() ?? '';

  // PostgreSQL SQLSTATE classes.
  if (code === '42501') return new PushRemoteError('authorization', code);
  if (code.startsWith('23')) return new PushRemoteError('constraint', code);
  // Serialization failures and deadlocks are transient contention, not a
  // revision conflict: the same statement is expected to succeed on a retry.
  if (
    code === '40001' ||
    code === '40P01' ||
    code.startsWith('53') ||
    code.startsWith('57') ||
    code.startsWith('58')
  ) {
    return new PushRemoteError('remote_unknown', code);
  }
  // PostgREST codes.
  if (code === 'PGRST301' || code === 'PGRST302') return new PushRemoteError('auth', code);
  if (code === 'PGRST204' || code === 'PGRST205') {
    return new PushRemoteError('invalid_local_data', code);
  }

  if (isNetworkMessage(message)) return new PushRemoteError('network');
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return new PushRemoteError('authorization', code === '' ? undefined : code);
  }
  if (message.includes('jwt') || message.includes('not authenticated')) {
    return new PushRemoteError('auth', code === '' ? undefined : code);
  }
  return new PushRemoteError('remote_unknown', code === '' ? undefined : code);
}

function classifyThrownError(error: unknown): PushErrorCode {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return isNetworkMessage(message) ? 'network' : 'remote_unknown';
}

function isNetworkMessage(message: string): boolean {
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('offline') ||
    message.includes('econn') ||
    message.includes('enotfound')
  );
}
