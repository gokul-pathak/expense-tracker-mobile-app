/**
 * What the Cloud Sync screen is allowed to claim.
 *
 * The status is derived on every read from durable facts — the binding, the
 * queue, the conflict log, the last run — and never stored. A stored status
 * would be a second source of truth that drifts from the data it describes, and
 * the one thing this screen must not do is tell someone their financial records
 * are safely in the cloud when they are not.
 */

export const CLOUD_SYNC_STATUSES = [
  'unconfigured',
  'local_only',
  'setup_required',
  'reconciliation_required',
  'linking',
  'syncing',
  'synced',
  'pending_changes',
  'offline',
  'auth_required',
  'account_mismatch',
  'attention_required',
  'error',
] as const;

export type CloudSyncStatus = (typeof CLOUD_SYNC_STATUSES)[number];

export type CloudSyncFacts = {
  /** False when this build has no Supabase configuration at all. */
  configured: boolean;
  /** The signed-in account, or null when signed out. */
  authenticatedUserId: string | null;
  /** The account this database has finished agreeing with. */
  linkedUserId: string | null;
  /** True while a first-link reconciliation is running. */
  linking: boolean;
  /** True while the local dataset was replaced under a link. */
  reconciliationRequired: boolean;
  /** True while a sync cycle is running. */
  syncing: boolean;
  /** Local mutations waiting to upload. */
  pendingChanges: number;
  /** Records the engine refused, or conflicts it could not resolve. */
  attentionRequired: number;
  /** Compact code from the last failed run, never a remote message. */
  lastError: string | null;
  /** True when the last failure was a connectivity problem. */
  offline: boolean;
};

/**
 * "Synced" is the strongest claim this app makes about someone's money, so it
 * requires every part of the cycle to have succeeded: a real binding, an empty
 * queue, nothing waiting for attention, and no error left over. A successful
 * network request on its own is not enough.
 */
export function deriveCloudSyncStatus(facts: CloudSyncFacts): CloudSyncStatus {
  if (!facts.configured) return 'unconfigured';
  if (facts.linking) return 'linking';
  if (facts.authenticatedUserId === null) {
    // Signed out with a binding still recorded is a device waiting to sign back
    // in, not a local-only device.
    return facts.linkedUserId === null ? 'local_only' : 'auth_required';
  }
  if (facts.linkedUserId === null) return 'setup_required';
  if (facts.linkedUserId !== facts.authenticatedUserId) return 'account_mismatch';
  if (facts.reconciliationRequired) return 'reconciliation_required';
  if (facts.syncing) return 'syncing';
  if (facts.attentionRequired > 0) return 'attention_required';
  if (facts.offline) return 'offline';
  if (facts.pendingChanges > 0) return 'pending_changes';
  if (facts.lastError !== null) return 'error';
  return 'synced';
}

/** Whether the user may start a sync cycle right now. */
export function canSyncNow(status: CloudSyncStatus): boolean {
  return (
    status === 'synced' ||
    status === 'pending_changes' ||
    status === 'offline' ||
    status === 'error' ||
    status === 'attention_required'
  );
}

/** Whether this device is bound to a cloud account at all. */
export function isCloudLinked(status: CloudSyncStatus): boolean {
  return (
    status === 'synced' ||
    status === 'pending_changes' ||
    status === 'offline' ||
    status === 'syncing' ||
    status === 'error' ||
    status === 'attention_required' ||
    status === 'reconciliation_required' ||
    status === 'account_mismatch'
  );
}
