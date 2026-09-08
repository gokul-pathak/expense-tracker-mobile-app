import { reseedDefaultsIfMissing } from '@/db/seed';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';
import {
  createSafetyBackup as createSafetyBackupFile,
  type SafetyBackupResult,
} from '@/features/backup/safety-backup.service';
import type { SafetyBackupReason } from '@/features/backup/safety-backup.types';

import {
  cloudInventoryOf,
  downloadCloudSnapshot,
  snapshotBaselines,
  toRemoteDataset,
  validateCloudSnapshot,
  CloudSnapshotError,
  type CloudSnapshot,
} from './cloud-snapshot.service';
import { readLocalDataInventory, type DataInventory } from './data-inventory';
import { InitialUploadError, performInitialUpload } from './initial-upload.service';
import { PULL_BATCH_SIZE, pullRemoteChanges } from './pull-sync.service';
import {
  createSupabasePullRepository,
  createSupabaseSnapshotRepository,
  createSupabaseSyncRepository,
  type RemotePullRepository,
  type RemoteSnapshotRepository,
  type RemoteSyncRepository,
} from './remote/supabase-sync.repository';
import {
  rebindRemoteSettingsIdentity,
  replaceLocalDataFromRemote,
} from './remote-apply.repository';
import { recordSyncBaseline } from './sync-baseline.repository';
import { withSyncEngineLock, withUserMutationsSuspended } from './sync-lock';
import {
  clearSyncOutbox,
  getCloudBinding,
  rekeySyncMutation,
  updateSyncState,
} from './sync.repository';
import { readLocalSettingsSyncId } from './sync-source.repository';

/**
 * First cloud link: deciding what "this device and this account" should mean,
 * and committing that decision safely.
 *
 * Authentication is not linking. Signing in proves who someone is; it says
 * nothing about whether the financial records on this device belong to that
 * account. A database becomes linked only after one of these flows completes,
 * which is what stops a sign-in from quietly publishing — or quietly replacing —
 * someone's financial history.
 *
 * Three rules hold throughout:
 *
 * 1. Nothing destructive happens without a recovery snapshot written first.
 * 2. The binding is committed last. A run that fails leaves a database that is
 *    still exactly what it was, and still not linked.
 * 3. User writes are suspended for the critical section, so a transaction added
 *    mid-setup cannot be captured by neither side.
 */

/** Which of the four situations this device and account are in. */
export const RECONCILIATION_CASES = {
  bothEmpty: 'A',
  localOnly: 'B',
  cloudOnly: 'C',
  bothPopulated: 'D',
} as const;

export type ReconciliationCase = (typeof RECONCILIATION_CASES)[keyof typeof RECONCILIATION_CASES];

export type CloudLinkInspection = {
  case: ReconciliationCase;
  local: DataInventory;
  cloud: DataInventory;
  userId: string;
};

export type ReconciliationChoice = 'use_local' | 'use_cloud';

export type ReconciliationFailureReason =
  | 'unavailable'
  | 'auth_required'
  | 'account_mismatch'
  | 'busy'
  | 'invalid_local_data'
  | 'invalid_cloud_data'
  | 'network'
  | 'backup_failed'
  | 'apply_failed';

export type ReconciliationResult =
  | {
      status: 'linked';
      case: ReconciliationCase;
      choice: ReconciliationChoice;
      uploaded: number;
      tombstoned: number;
      downloaded: number;
      cursor: number | null;
      backup: SafetyBackupResult | null;
    }
  | { status: 'failed'; reason: ReconciliationFailureReason; detail?: string };

export type ReconciliationDependencies = {
  getAuthenticatedUserId: () => Promise<string | null>;
  createRemote: () => RemoteSyncRepository | null;
  createPullRemote: () => RemotePullRepository | null;
  createSnapshotRemote: () => RemoteSnapshotRepository | null;
  createSafetyBackup: (reason: SafetyBackupReason) => Promise<SafetyBackupResult>;
  reseedDefaults: () => Promise<boolean>;
};

export type ReconciliationOptions = { dependencies?: Partial<ReconciliationDependencies> };

type Ready = {
  userId: string;
  remote: RemoteSyncRepository;
  pullRemote: RemotePullRepository;
  snapshots: RemoteSnapshotRepository;
  dependencies: ReconciliationDependencies;
};

/**
 * Looks at both sides before anything is offered to the user.
 *
 * "Meaningful data" is a domain judgement, not a row count: a fresh install has
 * seeded categories and a settings row, and treating those as data would turn
 * every first link into the dangerous both-populated case.
 */
export async function inspectCloudLink(
  options: ReconciliationOptions = {},
): Promise<
  | { status: 'ok'; inspection: CloudLinkInspection }
  | { status: 'failed'; reason: ReconciliationFailureReason; detail?: string }
> {
  const ready = await prepare(options);
  if ('failed' in ready) return { status: 'failed', reason: ready.reason, detail: ready.detail };

  let snapshot: CloudSnapshot;
  try {
    snapshot = await downloadCloudSnapshot(ready.snapshots, ready.userId);
  } catch (error) {
    return { status: 'failed', ...classify(error) };
  }

  const local = readLocalDataInventory();
  const cloud = cloudInventoryOf(snapshot);
  return {
    status: 'ok',
    inspection: {
      case: resolveCase(local.hasMeaningfulData, cloud.hasMeaningfulData),
      local,
      cloud,
      userId: ready.userId,
    },
  };
}

export function resolveCase(localHasData: boolean, cloudHasData: boolean): ReconciliationCase {
  if (!localHasData && !cloudHasData) return RECONCILIATION_CASES.bothEmpty;
  if (localHasData && !cloudHasData) return RECONCILIATION_CASES.localOnly;
  if (!localHasData && cloudHasData) return RECONCILIATION_CASES.cloudOnly;
  return RECONCILIATION_CASES.bothPopulated;
}

/**
 * Links using what is on this device.
 *
 * Case A and B are additive; case D also retires the cloud records this device
 * does not have, because leaving them would let the very next pull download the
 * replaced data straight back.
 */
export function linkUsingLocalData(
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  return runReconciliation('use_local', options);
}

/** Links using what the account already holds, replacing this device's dataset. */
export function linkUsingCloudData(
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  return runReconciliation('use_cloud', options);
}

function runReconciliation(
  choice: ReconciliationChoice,
  options: ReconciliationOptions,
): Promise<ReconciliationResult> {
  return withSyncEngineLock(
    'reconciliation',
    () =>
      withUserMutationsSuspended(async () => {
        const ready = await prepare(options);
        if ('failed' in ready) return { status: 'failed', ...ready } as ReconciliationResult;
        try {
          return choice === 'use_local' ? await useLocalData(ready) : await useCloudData(ready);
        } finally {
          // A run that did not reach its commit must not leave a database
          // claiming to be mid-link forever.
          if (getCloudBinding().linkedUserId === null) {
            updateSyncState({ pendingLinkUserId: null });
          }
        }
      }),
    () => ({ status: 'failed', reason: 'busy' }),
  );
}

async function useLocalData(ready: Ready): Promise<ReconciliationResult> {
  const local = readLocalDataInventory();

  let snapshot: CloudSnapshot;
  try {
    snapshot = await downloadCloudSnapshot(ready.snapshots, ready.userId);
  } catch (error) {
    return failureOf(error);
  }
  const cloud = cloudInventoryOf(snapshot);
  const reconciliationCase = resolveCase(local.hasMeaningfulData, cloud.hasMeaningfulData);

  // Nothing to protect when the device holds nothing.
  let backup: SafetyBackupResult | null = null;
  if (local.hasMeaningfulData) {
    const created = await takeSafetyBackup(
      ready,
      cloud.hasMeaningfulData ? 'pre-cloud-replace' : 'pre-cloud-link',
    );
    if ('failed' in created) return { status: 'failed', ...created } as ReconciliationResult;
    backup = created.backup;
  }

  // The cloud identifies settings by their owner, so uploading this device's
  // settings row under a different identity would retire the cloud's one and
  // orphan every change that referred to it. Adopting the cloud identity first
  // keeps one settings record per account, exactly as pull does.
  adoptCloudSettingsIdentity(snapshot.settings[0]?.sync_id ?? null);

  updateSyncState({ pendingLinkUserId: ready.userId });

  let uploaded = 0;
  let tombstoned = 0;
  try {
    const result = await performInitialUpload({
      userId: ready.userId,
      remote: ready.remote,
      snapshots: ready.snapshots,
      // Retiring obsolete cloud rows is what makes this a replacement rather
      // than a merge with whatever was there before.
      replaceCloudDataset: cloud.hasMeaningfulData,
    });
    uploaded = result.uploaded;
    tombstoned = result.tombstoned;
  } catch (error) {
    return failureOf(error);
  }

  // Converge against what the cloud now actually holds: this establishes the
  // cursor and the per-record baselines, and proves the upload landed.
  //
  // The batch bound that protects an ordinary sync run would stop this one
  // part-way through a large first upload, leaving a linked device whose cursor
  // is thousands of changes behind and whose next few syncs are heavy. Setup
  // happens once, so it is allowed to read as far as its own upload reaches.
  const pull = await pullRemoteChanges({
    acceptPendingLink: true,
    maxBatches: convergenceBatches(uploaded + tombstoned),
    dependencies: {
      getAuthenticatedUserId: async () => ready.userId,
      createRemote: () => ready.pullRemote,
    },
  });
  if (pull.status !== 'success' && pull.status !== 'idle' && pull.status !== 'conflict') {
    return { status: 'failed', reason: pullFailureReason(pull.status), detail: pull.status };
  }

  commitLink(ready.userId, { clearOutbox: true });
  return {
    status: 'linked',
    case: reconciliationCase,
    choice: 'use_local',
    uploaded,
    tombstoned,
    downloaded: pull.applied,
    cursor: pull.cursor,
    backup,
  };
}

async function useCloudData(ready: Ready): Promise<ReconciliationResult> {
  const local = readLocalDataInventory();

  // Download and vet everything before a single local row is touched.
  let snapshot: CloudSnapshot;
  try {
    snapshot = await downloadCloudSnapshot(ready.snapshots, ready.userId);
    validateCloudSnapshot(snapshot);
  } catch (error) {
    return failureOf(error);
  }
  const cloud = cloudInventoryOf(snapshot);
  const reconciliationCase = resolveCase(local.hasMeaningfulData, cloud.hasMeaningfulData);

  let backup: SafetyBackupResult | null = null;
  if (local.hasMeaningfulData) {
    const created = await takeSafetyBackup(ready, 'pre-cloud-restore');
    if ('failed' in created) return { status: 'failed', ...created } as ReconciliationResult;
    backup = created.backup;
  }

  updateSyncState({ pendingLinkUserId: ready.userId });

  const dataset = toRemoteDataset(snapshot);
  const baselines = snapshotBaselines(snapshot);
  try {
    replaceLocalDataFromRemote(dataset, (writer) => {
      // Queued work described the dataset that has just been replaced.
      clearSyncOutbox(writer);
      for (const baseline of baselines) recordSyncBaseline(baseline, writer);
      updateSyncState(
        {
          linkedUserId: ready.userId,
          pendingLinkUserId: null,
          reconciliationRequired: false,
          pullCursor: snapshot.latestSequence,
          lastSuccessfulPullAt: new Date(),
          lastSuccessfulSyncAt: new Date(),
          lastSyncError: null,
        },
        writer,
      );
    });
  } catch (error) {
    return { status: 'failed', reason: 'apply_failed', detail: errorName(error) };
  }

  // A cloud account may legitimately hold no categories at all; the device still
  // needs them to record anything.
  await ready.dependencies.reseedDefaults();

  return {
    status: 'linked',
    case: reconciliationCase,
    choice: 'use_cloud',
    uploaded: 0,
    tombstoned: 0,
    downloaded:
      snapshot.accounts.length +
      snapshot.categories.length +
      snapshot.people.length +
      snapshot.settings.length +
      snapshot.transactions.length,
    cursor: snapshot.latestSequence,
    backup,
  };
}

/**
 * Commits the binding, last.
 *
 * The outbox is cleared only here, and only on the local-data path: the upload
 * plus the pull that followed it have just proven the cloud holds exactly this
 * dataset, and user writes have been suspended throughout, so nothing queued can
 * still be unsent intent.
 */
function commitLink(userId: string, options: { clearOutbox: boolean }) {
  if (options.clearOutbox) clearSyncOutbox();
  updateSyncState({
    linkedUserId: userId,
    pendingLinkUserId: null,
    reconciliationRequired: false,
    lastSuccessfulSyncAt: new Date(),
    lastSyncError: null,
  });
}

/**
 * Enough batches to read back everything this link just wrote, plus room for the
 * duplicate change rows the cloud trigger appends and for another device writing
 * at the same time. Still bounded: a runaway feed stops rather than looping.
 */
function convergenceBatches(writtenRows: number): number {
  const CHANGES_PER_ROW = 2;
  const HEADROOM_BATCHES = 20;
  const MAX_BATCHES = 1000;
  const needed = Math.ceil((writtenRows * CHANGES_PER_ROW) / PULL_BATCH_SIZE) + HEADROOM_BATCHES;
  return Math.min(needed, MAX_BATCHES);
}

function adoptCloudSettingsIdentity(cloudSettingsSyncId: string | null) {
  if (cloudSettingsSyncId === null) return;
  const localSyncId = readLocalSettingsSyncId();
  if (localSyncId === null || localSyncId === cloudSettingsSyncId) return;
  rebindRemoteSettingsIdentity(cloudSettingsSyncId);
  rekeySyncMutation('settings', localSyncId, cloudSettingsSyncId);
}

async function takeSafetyBackup(
  ready: Ready,
  reason: SafetyBackupReason,
): Promise<
  { backup: SafetyBackupResult } | { failed: true; reason: 'backup_failed'; detail: string }
> {
  try {
    return { backup: await ready.dependencies.createSafetyBackup(reason) };
  } catch (error) {
    // Without a recovery snapshot nothing destructive may proceed.
    return { failed: true, reason: 'backup_failed', detail: errorName(error) };
  }
}

async function prepare(
  options: ReconciliationOptions,
): Promise<Ready | { failed: true; reason: ReconciliationFailureReason; detail?: string }> {
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const remote = dependencies.createRemote();
  const pullRemote = dependencies.createPullRemote();
  const snapshots = dependencies.createSnapshotRemote();
  if (remote === null || pullRemote === null || snapshots === null) {
    return { failed: true, reason: 'unavailable' };
  }

  const userId = await dependencies.getAuthenticatedUserId().catch(() => null);
  if (userId === null) return { failed: true, reason: 'auth_required' };

  // A database already bound to one account is never re-pointed at another.
  const binding = getCloudBinding();
  if (binding.linkedUserId !== null && binding.linkedUserId !== userId) {
    return { failed: true, reason: 'account_mismatch' };
  }

  return { userId, remote, pullRemote, snapshots, dependencies };
}

type Failure = { reason: ReconciliationFailureReason; detail?: string };

/** Classifies a thrown error without letting a remote message reach the UI. */
function classify(error: unknown): Failure {
  if (error instanceof CloudSnapshotError) {
    return {
      reason: error.reason === 'remote' ? 'network' : 'invalid_cloud_data',
      detail: error.detail,
    };
  }
  if (error instanceof InitialUploadError) {
    return {
      reason: error.reason === 'remote' ? 'network' : 'invalid_local_data',
      detail: error.detail,
    };
  }
  return { reason: 'network', detail: errorName(error) };
}

function failureOf(error: unknown): ReconciliationResult {
  return { status: 'failed', ...classify(error) };
}

function pullFailureReason(status: string): ReconciliationFailureReason {
  if (status === 'offline') return 'network';
  if (status === 'auth_required') return 'auth_required';
  if (status === 'account_mismatch') return 'account_mismatch';
  return 'invalid_cloud_data';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

function defaultDependencies(): ReconciliationDependencies {
  return {
    getAuthenticatedUserId: async () => {
      try {
        const session = await cloudAuthService.getSession();
        return session?.user.id ?? null;
      } catch {
        return null;
      }
    },
    createRemote: () => createSupabaseSyncRepository(),
    createPullRemote: () => createSupabasePullRepository(),
    createSnapshotRemote: () => createSupabaseSnapshotRepository(),
    createSafetyBackup: (reason) => createSafetyBackupFile(reason),
    reseedDefaults: () => reseedDefaultsIfMissing(),
  };
}
