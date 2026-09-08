import type { SyncConflictResolution, SyncEntityType, SyncOperation } from '@/db/schema';

/**
 * Outcome of one `pullRemoteChanges()` run.
 *
 * `success` means every change this run read was applied and the cursor moved
 * with it. It still does not mean the device is fully synchronized: pending
 * local work may be waiting for a push, and orchestrating both is M7F's job.
 */
export const PULL_STATUSES = [
  'success',
  'idle',
  'pulling',
  'unavailable',
  'auth_required',
  'not_linked',
  'reconciliation_required',
  'account_mismatch',
  'offline',
  'conflict',
  'attention_required',
  'error',
] as const;

export type PullStatus = (typeof PULL_STATUSES)[number];

/**
 * Internal failure categories. Later UI reads these instead of parsing raw
 * PostgREST strings, and they never carry financial values.
 */
export const PULL_ERROR_CODES = [
  'network',
  'auth',
  'authorization',
  'account_mismatch',
  'invalid_remote_data',
  'foreign_owner',
  'unknown_parent',
  'domain_invariant',
  'unsupported_remote_data',
  'remote_row_missing',
  'apply_failed',
  'remote_unknown',
] as const;

export type PullErrorCode = (typeof PULL_ERROR_CODES)[number];

/** Failures worth attempting again unchanged on the next run. */
const RETRYABLE: readonly PullErrorCode[] = ['network', 'remote_unknown', 'apply_failed'];

export function isRetryablePullError(code: PullErrorCode): boolean {
  return RETRYABLE.includes(code);
}

/** A failure that describes the connection or the session, not one row. */
const REQUEST_SCOPED: readonly PullErrorCode[] = [
  'network',
  'auth',
  'authorization',
  'account_mismatch',
];

export function isRequestScopedPullError(code: PullErrorCode): boolean {
  return REQUEST_SCOPED.includes(code);
}

/**
 * A remote change this run refused to apply. The cursor stops before it rather
 * than stepping over it, so a rejected record is never silently skipped.
 */
export type PullFailure = {
  entityType: SyncEntityType;
  /** Absent for failures that describe the request rather than one record. */
  entitySyncId?: string;
  sequence?: number;
  code: PullErrorCode;
  /** Compact technical detail such as a field path. Never a value. */
  detail?: string;
};

export type PullConflictOutcome = {
  entityType: SyncEntityType;
  entitySyncId: string;
  /** What the local side had queued, if anything. */
  localOperation: SyncOperation | null;
  resolution: SyncConflictResolution;
  remoteServerRevision: number;
  baseServerRevision: number | null;
  detail?: string;
};

export type PullSyncResult = {
  status: PullStatus;
  /** Change-feed rows read from the cloud. */
  received: number;
  /** Records inserted or updated locally. */
  applied: number;
  /** Records where local and remote had both moved on. */
  conflicted: number;
  /** Tombstones applied locally. */
  deleted: number;
  /** Records refused. The cursor stops before the first of them. */
  failed: number;
  cursorAdvanced: boolean;
  /** Cursor position after the run, or null when none was ever established. */
  cursor: number | null;
  batches: number;
  conflicts: PullConflictOutcome[];
  failures: PullFailure[];
};

export function emptyPullResult(status: PullStatus, cursor: number | null): PullSyncResult {
  return {
    status,
    received: 0,
    applied: 0,
    conflicted: 0,
    deleted: 0,
    failed: 0,
    cursorAdvanced: false,
    cursor,
    batches: 0,
    conflicts: [],
    failures: [],
  };
}
