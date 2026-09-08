import type { SyncEntityType, SyncOperation } from '@/db/schema';

/**
 * Outcome of one `pushPendingChanges()` run.
 *
 * `success` means every operation this run touched reached the cloud. It does
 * NOT mean the device is fully synchronized: pull does not exist yet, so no
 * part of the app may present this as "Synced".
 */
export const PUSH_STATUSES = [
  'success',
  'idle',
  'pushing',
  'unavailable',
  'auth_required',
  'not_linked',
  'reconciliation_required',
  'account_mismatch',
  'offline',
  'error',
] as const;

export type PushStatus = (typeof PUSH_STATUSES)[number];

/**
 * Internal failure categories. Later UI reads these instead of parsing raw
 * PostgREST strings, and they never carry financial values.
 *
 * `conflict` is declared but never produced yet: the cloud schema has no
 * conditional revision write for push to lose against. It is the signal M7E
 * will return from that endpoint so a caller knows to pull before retrying.
 */
export const PUSH_ERROR_CODES = [
  'network',
  'auth',
  'authorization',
  'constraint',
  'invalid_local_data',
  'account_mismatch',
  'conflict',
  'remote_unknown',
] as const;

export type PushErrorCode = (typeof PUSH_ERROR_CODES)[number];

/** Failures worth attempting again unchanged on the next run. */
const RETRYABLE: readonly PushErrorCode[] = ['network', 'remote_unknown'];

export function isRetryablePushError(code: PushErrorCode): boolean {
  return RETRYABLE.includes(code);
}

/** A failure that describes the whole request rather than one specific row. */
const REQUEST_SCOPED: readonly PushErrorCode[] = [
  'network',
  'auth',
  'authorization',
  'account_mismatch',
];

export function isRequestScopedPushError(code: PushErrorCode): boolean {
  return REQUEST_SCOPED.includes(code);
}

export type PushFailure = {
  entityType: SyncEntityType;
  entitySyncId: string;
  operation: SyncOperation;
  code: PushErrorCode;
  /** Compact technical detail such as a SQLSTATE. Never a row or a message. */
  detail?: string;
};

export type PushSyncResult = {
  status: PushStatus;
  /** Operations this run attempted to upload. */
  processed: number;
  /** Operations the cloud confirmed. */
  succeeded: number;
  /** Operations that failed and stayed pending. */
  failed: number;
  /** Operations still queued after the run. */
  remaining: number;
  failures: PushFailure[];
};

export function emptyPushResult(status: PushStatus, remaining: number): PushSyncResult {
  return { status, processed: 0, succeeded: 0, failed: 0, remaining, failures: [] };
}
