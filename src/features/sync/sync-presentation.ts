import type { CloudSyncStatus } from './sync-status';

/**
 * The words the Cloud Sync screen uses.
 *
 * Kept apart from the screen so the wording can be tested, and so no technical
 * code ever reaches a person: `PGRST116`, `JWT expired` and SQLSTATEs are
 * diagnostics, not sentences. Every message here says what happened to their
 * money and what, if anything, they should do about it.
 */

export type SyncStatusCopy = { title: string; description: string };

export function describeSyncStatus(status: CloudSyncStatus): SyncStatusCopy {
  switch (status) {
    case 'unconfigured':
      return {
        title: 'Local Only',
        description:
          "Cloud Sync isn't available in this build. Your financial data is stored on this device.",
      };
    case 'local_only':
      return {
        title: 'Local Only',
        description: 'Your financial data is currently stored on this device.',
      };
    case 'setup_required':
      return {
        title: 'Not Set Up',
        description: 'This device has not been linked to cloud sync yet.',
      };
    case 'reconciliation_required':
      return {
        title: 'Attention Required',
        description:
          'This device’s data was replaced from a backup. Set up cloud sync again to choose which copy to keep.',
      };
    case 'linking':
      return { title: 'Setting Up', description: 'Setting up cloud sync…' };
    case 'syncing':
      return { title: 'Syncing', description: 'Syncing your financial data…' };
    case 'synced':
      return { title: 'Synced', description: 'Your financial data is up to date.' };
    case 'pending_changes':
      return {
        title: 'Pending Changes',
        description: 'Some changes are still waiting to upload.',
      };
    case 'offline':
      return {
        title: 'Offline',
        description: "Your changes are saved on this device and will sync when you're online.",
      };
    case 'auth_required':
      return {
        title: 'Sign In Required',
        description: 'Sign in again to continue syncing this device.',
      };
    case 'account_mismatch':
      return {
        title: 'Account Mismatch',
        description: "This device's financial data is linked to a different cloud account.",
      };
    case 'attention_required':
      return {
        title: 'Attention Required',
        description: "Some changes couldn't be synced and need a look.",
      };
    case 'error':
      return {
        title: 'Sync Problem',
        description: "The last sync didn't finish. You can try again.",
      };
  }
}

/** How many local changes are still waiting, in plain words. */
export function describePendingChanges(count: number, offline: boolean): string | null {
  if (count <= 0) return null;
  const changes = count === 1 ? '1 change' : `${count} changes`;
  return offline ? `${changes} will sync when you're online` : `${changes} waiting to upload`;
}

/**
 * A failure code from the sync engines, as something a person can act on.
 * Unknown codes deliberately fall back to a plain sentence rather than leaking
 * whatever the server said.
 */
export function describeSyncError(code: string | null): string | null {
  if (code === null) return null;
  switch (code) {
    case 'network':
      return "You're offline.";
    case 'auth':
    case 'auth_required':
      return 'Sign in again to continue syncing.';
    case 'authorization':
      return "This account isn't allowed to sync this data.";
    case 'account_mismatch':
      return 'Cloud account mismatch.';
    case 'invalid_remote_data':
    case 'foreign_owner':
    case 'unsupported_remote_data':
    case 'remote_row_missing':
      return 'Cloud data needs attention.';
    case 'domain_invariant':
    case 'unknown_parent':
      return "Some records couldn't be applied and need a look.";
    case 'invalid_local_data':
      return "Some changes on this device couldn't be uploaded.";
    default:
      return "Some changes couldn't be synced.";
  }
}

/** Absolute time, because "2 hours ago" is not what someone checks a balance for. */
export function describeLastSync(at: Date | null): string {
  return at === null ? 'Never' : at.toLocaleString();
}

export type ReconciliationCopy = {
  title: string;
  body: string;
  confirmLabel: string;
  /** Present only when the choice destroys something. */
  warning?: string;
};

/**
 * The consequence of each first-link choice, said plainly.
 *
 * "Continue" is never enough here: one of these replaces a person's financial
 * history, and they are entitled to read which one before they tap it.
 */
export function describeUseLocalData(cloudHasData: boolean): ReconciliationCopy {
  return cloudHasData
    ? {
        title: "Use This Device's Data",
        body: 'Your cloud financial data will be replaced by the data currently on this device.',
        warning:
          'The financial records already in your cloud account will be replaced. A backup of this device is saved first.',
        confirmLabel: 'Replace Cloud Data',
      }
    : {
        title: "Use This Device's Data",
        body: 'Your current financial data will be uploaded to your cloud account so it can sync with other devices.',
        confirmLabel: 'Upload and Link',
      };
}

export function describeUseCloudData(localHasData: boolean): ReconciliationCopy {
  return localHasData
    ? {
        title: 'Use Cloud Data',
        body: 'The financial data currently on this device will be replaced by your cloud data.',
        warning:
          'The records on this device will be replaced. A backup of this device is saved first.',
        confirmLabel: 'Replace This Device',
      }
    : {
        title: 'Restore From Cloud',
        body: 'This cloud account already has financial data. Download it to this device?',
        confirmLabel: 'Download and Link',
      };
}

/** Progress wording during setup. Never a fabricated percentage. */
export const SETUP_STEPS = {
  inspecting: 'Checking cloud data…',
  backing_up: 'Creating safety backup…',
  uploading: 'Uploading your data…',
  downloading: 'Downloading cloud data…',
  finishing: 'Finishing setup…',
} as const;

export type SetupStep = keyof typeof SETUP_STEPS;

export function describeReconciliationFailure(reason: string): string {
  switch (reason) {
    case 'unavailable':
      return "Cloud Sync isn't available in this build.";
    case 'auth_required':
      return 'Sign in again to set up cloud sync.';
    case 'account_mismatch':
      return 'This device is linked to a different cloud account. Sign out of that account first.';
    case 'busy':
      return 'Cloud sync setup is already running.';
    case 'backup_failed':
      return "A safety backup couldn't be saved, so setup stopped. Your data is unchanged.";
    case 'invalid_cloud_data':
      return "Your cloud data couldn't be used. Nothing on this device was changed.";
    case 'invalid_local_data':
      return "Some records on this device couldn't be uploaded. Nothing was changed.";
    case 'network':
      return "Cloud sync setup couldn't be completed. Check your connection and try again.";
    default:
      return "Cloud sync setup couldn't be completed. Your existing local data is unchanged.";
  }
}
