import { reseedDefaultsIfMissing } from '@/db/seed';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';

import { emitSyncedDataChanged } from './sync-events';
import { pullRemoteChanges, type PullSyncOptions } from './pull-sync.service';
import type { PullStatus } from './pull-sync.types';
import { pushPendingChanges, type PushSyncOptions } from './push-sync.service';
import type { PushStatus } from './push-sync.types';
import { replaceLocalDataFromRemote } from './remote-apply.repository';
import { countSyncConflicts } from './sync-baseline.repository';
import { isSyncEngineRunning } from './sync-lock';
import {
  clearCloudBinding,
  clearSyncOutbox,
  countPendingSyncMutations,
  getCloudBinding,
  getSyncState,
  updateSyncState,
} from './sync.repository';
import { deriveCloudSyncStatus, type CloudSyncStatus } from './sync-status';

/**
 * The one entry point the app uses to synchronize.
 *
 * Screens call `syncNow()`. They do not call push and pull themselves, because
 * the order and the stopping condition are the interesting part: a pull that
 * decides a local edit wins leaves that edit queued, and without a second push
 * the two devices would stay disagreeing while the UI happily said "Synced".
 *
 * Everything below still reads and writes SQLite only. No screen ever sees a
 * cloud row.
 */

/** Push passes per cycle. Two is enough for push → pull → push; more would loop. */
const MAX_PUSH_PASSES = 2;

export type SyncCycleStatus =
  | 'success'
  | 'offline'
  | 'auth_required'
  | 'not_linked'
  | 'reconciliation_required'
  | 'account_mismatch'
  | 'attention_required'
  | 'unavailable'
  | 'busy'
  | 'error';

export type SyncResult = {
  status: SyncCycleStatus;
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
  /** Local mutations still waiting after the cycle. */
  pending: number;
  cursor: number | null;
};

export type SyncNowOptions = {
  push?: PushSyncOptions;
  pull?: PullSyncOptions;
};

export function isSyncCycleRunning(): boolean {
  return isSyncEngineRunning();
}

/**
 * One complete cycle: send what is queued, take what is new, then send again if
 * conflict resolution kept a local change that has still not reached the cloud.
 */
export async function syncNow(options: SyncNowOptions = {}): Promise<SyncResult> {
  let pushed = 0;
  let conflicts = 0;

  const first = await pushPendingChanges(options.push);
  pushed += first.succeeded;
  if (!isPushUsable(first.status)) return failed(cycleStatusOfPush(first.status), { pushed });

  const pull = await pullRemoteChanges(options.pull);
  conflicts += pull.conflicts.length;
  if (!isPullUsable(pull.status)) {
    return failed(cycleStatusOfPull(pull.status), { pushed, conflicts, cursor: pull.cursor });
  }

  // A conflict the local side won stays queued; only a second push makes the
  // two devices actually agree.
  let passes = 1;
  while (passes < MAX_PUSH_PASSES && countPendingSyncMutations() > 0 && conflicts > 0) {
    const again = await pushPendingChanges(options.push);
    pushed += again.succeeded;
    passes += 1;
    if (!isPushUsable(again.status)) {
      return failed(cycleStatusOfPush(again.status), { pushed, conflicts, cursor: pull.cursor });
    }
  }

  if (pull.applied > 0 || pull.deleted > 0) emitSyncedDataChanged();

  const pending = countPendingSyncMutations();
  const status: SyncCycleStatus =
    pull.status === 'attention_required' || countSyncConflicts('attention_required') > 0
      ? 'attention_required'
      : 'success';

  if (status === 'success' && pending === 0) {
    // Both directions completed and nothing is left waiting, which is the only
    // state that may be presented as synchronized.
    updateSyncState({ lastSuccessfulSyncAt: new Date(), lastSyncError: null });
  }

  return {
    status,
    pushed,
    pulled: pull.applied,
    deleted: pull.deleted,
    conflicts,
    pending,
    cursor: pull.cursor,
  };
}

function failed(
  status: SyncCycleStatus,
  parts: { pushed?: number; conflicts?: number; cursor?: number | null },
): SyncResult {
  return {
    status,
    pushed: parts.pushed ?? 0,
    pulled: 0,
    deleted: 0,
    conflicts: parts.conflicts ?? 0,
    pending: countPendingSyncMutations(),
    cursor: parts.cursor ?? getSyncState()?.pullCursor ?? null,
  };
}

function isPushUsable(status: PushStatus): boolean {
  return status === 'success' || status === 'idle';
}

function isPullUsable(status: PullStatus): boolean {
  return (
    status === 'success' ||
    status === 'idle' ||
    status === 'conflict' ||
    status === 'attention_required'
  );
}

function cycleStatusOfPush(status: PushStatus): SyncCycleStatus {
  switch (status) {
    case 'offline':
      return 'offline';
    case 'auth_required':
      return 'auth_required';
    case 'not_linked':
      return 'not_linked';
    case 'reconciliation_required':
      return 'reconciliation_required';
    case 'account_mismatch':
      return 'account_mismatch';
    case 'unavailable':
      return 'unavailable';
    case 'pushing':
      return 'busy';
    default:
      return 'error';
  }
}

function cycleStatusOfPull(status: PullStatus): SyncCycleStatus {
  switch (status) {
    case 'offline':
      return 'offline';
    case 'auth_required':
      return 'auth_required';
    case 'not_linked':
      return 'not_linked';
    case 'reconciliation_required':
      return 'reconciliation_required';
    case 'account_mismatch':
      return 'account_mismatch';
    case 'unavailable':
      return 'unavailable';
    case 'pulling':
      return 'busy';
    case 'attention_required':
      return 'attention_required';
    default:
      return 'error';
  }
}

export type CloudSyncState = {
  status: CloudSyncStatus;
  linkedUserId: string | null;
  pendingChanges: number;
  attentionRequired: number;
  lastSuccessfulSyncAt: Date | null;
  lastError: string | null;
  reconciliationRequired: boolean;
};

/** Everything the Cloud Sync screen needs, read fresh from durable state. */
export function readCloudSyncState(input: {
  configured: boolean;
  authenticatedUserId: string | null;
  linking?: boolean;
  syncing?: boolean;
  offline?: boolean;
}): CloudSyncState {
  const state = getSyncState();
  const binding = getCloudBinding();
  const pendingChanges = countPendingSyncMutations();
  const attentionRequired = countSyncConflicts('attention_required');
  const lastError = state?.lastSyncError ?? null;

  return {
    status: deriveCloudSyncStatus({
      configured: input.configured,
      authenticatedUserId: input.authenticatedUserId,
      linkedUserId: binding.linkedUserId,
      linking: input.linking ?? isSyncEngineRunning('reconciliation'),
      reconciliationRequired: binding.reconciliationRequired,
      syncing: input.syncing ?? false,
      pendingChanges,
      attentionRequired,
      lastError,
      offline: input.offline ?? false,
    }),
    linkedUserId: binding.linkedUserId,
    pendingChanges,
    attentionRequired,
    lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null,
    lastError,
    reconciliationRequired: binding.reconciliationRequired,
  };
}

/**
 * Signs out and keeps every financial record on this device.
 *
 * The records, their global identities and any queued local intent all stay.
 * What is removed is the relationship with one cloud account: the binding, the
 * cursor and the per-record baselines. The device becomes local-only, and can be
 * reconciled again later — with the same account or another one.
 */
export async function signOutKeepingLocalData(): Promise<void> {
  clearCloudBinding();
  await cloudAuthService.signOut();
}

/**
 * Signs out and removes this device's copy of the financial data.
 *
 * The cloud account is untouched: this is a local removal, not a deletion of
 * anything stored remotely. App Lock lives outside SQLite and is deliberately
 * left alone — someone removing data from a shared device still wants the lock.
 */
export async function removeCloudDataFromDevice(): Promise<void> {
  replaceLocalDataFromRemote(
    { settings: [], accounts: [], categories: [], people: [], transactions: [] },
    (writer) => {
      clearSyncOutbox(writer);
    },
  );
  clearCloudBinding();
  await reseedDefaultsIfMissing();
  await cloudAuthService.signOut();
  emitSyncedDataChanged();
}

/** Detaches the database from its cloud account without signing out. */
export function unlinkCloudAccount(): void {
  clearCloudBinding();
}
