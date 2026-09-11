import type { SyncEntityType, SyncOperation, SyncOutboxEntry } from '@/db/schema';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';

import {
  MappingError,
  mapLocalAccountToRemote,
  mapLocalBudgetToRemote,
  mapLocalCategoryToRemote,
  mapLocalPersonToRemote,
  mapLocalRecurringOccurrenceToRemote,
  mapLocalRecurringTemplateToRemote,
  mapLocalSettingsToRemote,
  mapLocalTransactionToRemote,
  type MappingContext,
  type RelationResolver,
} from './mapping/local-to-remote';
import {
  emptyPushResult,
  isRequestScopedPushError,
  type PushErrorCode,
  type PushFailure,
  type PushStatus,
  type PushSyncResult,
} from './push-sync.types';
import { validateRemoteRow, type RemoteRow } from './remote/remote-rows';
import {
  createSupabaseSyncRepository,
  PushRemoteError,
  type RemoteSyncRepository,
} from './remote/supabase-sync.repository';
import { isSyncEngineRunning, withSyncEngineLock } from './sync-lock';
import {
  acknowledgeSyncMutation,
  countPendingSyncMutations,
  listPendingSyncMutationsForPush,
  markSyncAttempt,
  resolveSyncableUserId,
  updateSyncState,
} from './sync.repository';
import {
  readLocalBudget,
  readLocalEntity,
  readLocalRecurringOccurrence,
  readLocalRecurringTemplate,
  readLocalTransaction,
  readSyncIdsByLocalId,
} from './sync-source.repository';

/**
 * Push Sync.
 *
 * The durable outbox is the only source of outgoing work. Push reads the
 * current local row for each queued identity, maps it, uploads it, and only
 * then removes the queue entry. It never reads cloud data back into the app and
 * never modifies domain values: SQLite already holds the user's intended state,
 * and push is propagation.
 *
 * There is no first-upload scan here. Records that predate the outbox have sync
 * identities but no queued work on purpose; uploading an existing local
 * database belongs to the first cloud link, which does not exist yet.
 */

/** Outbox rows loaded per iteration. Bounded so a large queue is not held in memory. */
export const PUSH_BATCH_SIZE = 50;

/**
 * Upper bound on operations per invocation. Without it, a device receiving
 * continuous local edits could keep one push run alive indefinitely.
 */
export const PUSH_MAX_OPERATIONS_PER_RUN = 500;

/**
 * Dependency-safe phases. A cloud transaction has foreign keys to its account,
 * category and person rows, and a cloud budget has one to its category, so those
 * must exist remotely first. Parent tombstones run last so a deletion never
 * precedes the child rows that reference it.
 *
 * Recurring data forms a chain: a template names an account and a category, an
 * occurrence names its template, and a generated transaction names its
 * occurrence. Each link gets its own phase, in that order.
 *
 * A template's tombstone goes up with its upserts rather than at the end. A
 * deletion is uploaded as the row carrying `deleted_at`, and for a template
 * created, used and deleted between two pushes, that tombstone is the only
 * upload that will ever tell the cloud the template existed — which its
 * occurrences' foreign keys need before they can be accepted. Holding it back
 * would fail the occurrence phase on every run.
 */
const PUSH_PHASES: readonly {
  entityTypes: readonly SyncEntityType[];
  operations: readonly SyncOperation[];
}[] = [
  { entityTypes: ['settings', 'account', 'category', 'person'], operations: ['upsert'] },
  { entityTypes: ['recurring_template'], operations: ['upsert', 'delete'] },
  { entityTypes: ['recurring_occurrence'], operations: ['upsert', 'delete'] },
  { entityTypes: ['budget', 'transaction'], operations: ['upsert', 'delete'] },
  { entityTypes: ['settings', 'account', 'category', 'person'], operations: ['delete'] },
];

export type PushSyncDependencies = {
  /** Trusted ownership for every uploaded row. Local data never chooses it. */
  getAuthenticatedUserId: () => Promise<string | null>;
  /** Returns null when this build has no Supabase configuration. */
  createRemote: () => RemoteSyncRepository | null;
};

export type PushSyncOptions = {
  dependencies?: Partial<PushSyncDependencies>;
  batchSize?: number;
  maxOperations?: number;
  /**
   * Reconciliation only. It lets the first-link flow converge a database it is
   * still binding, without that half-finished state ever counting as a link.
   */
  acceptPendingLink?: boolean;
};

export function isPushRunning(): boolean {
  return isSyncEngineRunning('push');
}

/**
 * Concurrent runs are prevented by the shared engine lock, so a push cannot
 * interleave with a pull that is resolving the same queue entries. Durable
 * correctness comes from the outbox and idempotent cloud upserts, not from a
 * flag surviving a restart.
 */
export async function pushPendingChanges(options: PushSyncOptions = {}): Promise<PushSyncResult> {
  return withSyncEngineLock(
    'push',
    () => runPush(options),
    () => emptyPushResult('pushing', countPendingSyncMutations()),
  );
}

async function runPush(options: PushSyncOptions): Promise<PushSyncResult> {
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const batchSize = options.batchSize ?? PUSH_BATCH_SIZE;
  let operationBudget = options.maxOperations ?? PUSH_MAX_OPERATIONS_PER_RUN;

  const remote = dependencies.createRemote();
  if (remote === null) return emptyPushResult('unavailable', countPendingSyncMutations());

  // A session that cannot be read or refreshed is a reason to stop, never a
  // reason to fail the caller: the local app stays usable and work stays queued.
  const userId = await dependencies.getAuthenticatedUserId().catch(() => null);
  if (userId === null) return emptyPushResult('auth_required', countPendingSyncMutations());

  // Being signed in is not the same as this database belonging to that account.
  // Without an explicit link, uploading local financial data would silently
  // publish it to whichever account happened to sign in.
  const eligibility = resolveSyncableUserId(userId, {
    acceptPendingLink: options.acceptPendingLink,
  });
  if (!eligibility.ok) return emptyPushResult(eligibility.reason, countPendingSyncMutations());

  const context: MappingContext = { userId };
  const failures: PushFailure[] = [];
  const blocked = new Set<number>();
  let processed = 0;
  let succeeded = 0;
  let abortCode: PushErrorCode | undefined;

  for (const phase of PUSH_PHASES) {
    if (abortCode !== undefined) break;
    // A failure in an earlier phase may be exactly the parent a later phase
    // needs, so dependent phases are not attempted in this run.
    if (failures.length > 0) break;

    while (operationBudget > 0 && abortCode === undefined) {
      const entries = listPendingSyncMutationsForPush({
        entityTypes: phase.entityTypes,
        operations: phase.operations,
        limit: Math.min(batchSize, operationBudget),
        excludeIds: [...blocked],
      });
      if (entries.length === 0) break;

      for (const entityType of phase.entityTypes) {
        const group = entries.filter((entry) => entry.entityType === entityType);
        if (group.length === 0) continue;

        const outcome = await pushGroup(remote, entityType, group, context);
        processed += group.length;
        succeeded += outcome.succeeded;
        operationBudget -= group.length;
        for (const id of outcome.blockedIds) blocked.add(id);
        failures.push(...outcome.failures);
        if (outcome.abortCode !== undefined) {
          abortCode = outcome.abortCode;
          break;
        }
      }
    }
  }

  const remaining = countPendingSyncMutations();
  const status = resolveStatus({ abortCode, failures, processed });
  recordRunOutcome(status, failures);
  return { status, processed, succeeded, failed: failures.length, remaining, failures };
}

type GroupOutcome = {
  succeeded: number;
  failures: PushFailure[];
  blockedIds: number[];
  abortCode?: PushErrorCode;
};

async function pushGroup(
  remote: RemoteSyncRepository,
  entityType: SyncEntityType,
  entries: SyncOutboxEntry[],
  context: MappingContext,
): Promise<GroupOutcome> {
  const outcome: GroupOutcome = { succeeded: 0, failures: [], blockedIds: [] };
  const prepared: { entry: SyncOutboxEntry; row: RemoteRow }[] = [];
  const resolver = buildRelationResolver(entityType, entries);

  for (const entry of entries) {
    const mapped = prepareRow(entityType, entry, context, resolver);
    if (mapped.ok) {
      prepared.push({ entry, row: mapped.row });
    } else {
      recordFailure(outcome, entry, 'invalid_local_data', mapped.detail);
    }
  }

  if (prepared.length === 0) return outcome;

  try {
    await remote.upsert(
      entityType,
      prepared.map((item) => item.row),
    );
    for (const item of prepared) acknowledge(outcome, item.entry);
    return outcome;
  } catch (error) {
    const remoteError = toRemoteError(error);

    // A request-scoped failure describes the connection or the session, not one
    // row, so retrying rows individually would only repeat it.
    if (isRequestScopedPushError(remoteError.code) || prepared.length === 1) {
      for (const item of prepared) {
        recordFailure(outcome, item.entry, remoteError.code, remoteError.detail);
      }
      if (isRequestScopedPushError(remoteError.code)) outcome.abortCode = remoteError.code;
      return outcome;
    }

    // The statement was atomic, so nothing was written. Retrying row by row
    // attributes the failure precisely instead of blocking the whole group.
    for (const item of prepared) {
      try {
        await remote.upsert(entityType, [item.row]);
        acknowledge(outcome, item.entry);
      } catch (rowError) {
        const rowRemoteError = toRemoteError(rowError);
        recordFailure(outcome, item.entry, rowRemoteError.code, rowRemoteError.detail);
        if (isRequestScopedPushError(rowRemoteError.code)) {
          outcome.abortCode = rowRemoteError.code;
          return outcome;
        }
      }
    }
    return outcome;
  }
}

/**
 * The cloud confirmed this exact work, so the queue entry is removed only while
 * it still matches what was uploaded. A newer local edit bumped the revision and
 * stays pending for the next run; a failed removal is harmless because the next
 * upload of the same identity is idempotent.
 */
function acknowledge(outcome: GroupOutcome, entry: SyncOutboxEntry) {
  outcome.succeeded += 1;
  outcome.blockedIds.push(entry.id);
  try {
    acknowledgeSyncMutation(entry.id, entry.revision);
  } catch {
    // Remote state is correct; the entry simply stays queued for a safe retry.
  }
}

function recordFailure(
  outcome: GroupOutcome,
  entry: SyncOutboxEntry,
  code: PushErrorCode,
  detail?: string,
) {
  outcome.failures.push({
    entityType: entry.entityType,
    entitySyncId: entry.entitySyncId,
    operation: entry.operation,
    code,
    ...(detail === undefined ? {} : { detail }),
  });
  outcome.blockedIds.push(entry.id);
  // Only compact classification is stored: no payloads, responses or tokens.
  markSyncAttempt(entry.id, detail === undefined ? code : `${code}:${detail}`, {
    revision: entry.revision,
  });
}

function prepareRow(
  entityType: SyncEntityType,
  entry: SyncOutboxEntry,
  context: MappingContext,
  resolver: RelationResolver,
): { ok: true; row: RemoteRow } | { ok: false; detail: string } {
  const local = readLocalEntity(entityType, entry.entitySyncId);
  if (local === null) return { ok: false, detail: 'missing_local_row' };

  let mapped: RemoteRow;
  try {
    switch (local.entityType) {
      case 'account':
        mapped = mapLocalAccountToRemote(local.row, context);
        break;
      case 'budget':
        mapped = mapLocalBudgetToRemote(local.row, context, resolver);
        break;
      case 'category':
        mapped = mapLocalCategoryToRemote(local.row, context);
        break;
      case 'person':
        mapped = mapLocalPersonToRemote(local.row, context);
        break;
      case 'settings':
        mapped = mapLocalSettingsToRemote(local.row, context);
        break;
      case 'transaction':
        mapped = mapLocalTransactionToRemote(local.row, context, resolver);
        break;
      case 'recurring_template':
        mapped = mapLocalRecurringTemplateToRemote(local.row, context, resolver);
        break;
      case 'recurring_occurrence':
        mapped = mapLocalRecurringOccurrenceToRemote(local.row, context, resolver);
        break;
    }
  } catch (error) {
    return { ok: false, detail: error instanceof MappingError ? 'unresolved_relation' : 'mapping' };
  }

  const validated = validateRemoteRow(entityType, mapped);
  return validated.ok ? { ok: true, row: validated.row } : { ok: false, detail: validated.issue };
}

/** One lookup per relation per batch instead of one per row. */
function buildRelationResolver(
  entityType: SyncEntityType,
  entries: SyncOutboxEntry[],
): RelationResolver {
  if (entityType === 'transaction') return transactionResolver(entries);
  if (entityType === 'budget') return budgetResolver(entries);
  if (entityType === 'recurring_template') return recurringTemplateResolver(entries);
  if (entityType === 'recurring_occurrence') return recurringOccurrenceResolver(entries);
  return emptyResolver();
}

function transactionResolver(entries: SyncOutboxEntry[]): RelationResolver {
  const rows = entries
    .map((entry) => readLocalTransaction(entry.entitySyncId))
    .filter((row) => row !== null);

  const accountIds = rows.flatMap((row) =>
    [row.sourceAccountId, row.destinationAccountId].filter((id) => id !== null),
  );
  const accounts = readSyncIdsByLocalId('account', accountIds);
  const categories = readSyncIdsByLocalId(
    'category',
    rows.map((row) => row.categoryId).filter((id) => id !== null),
  );
  const people = readSyncIdsByLocalId(
    'person',
    rows.map((row) => row.personId).filter((id) => id !== null),
  );
  const occurrences = readSyncIdsByLocalId(
    'recurring_occurrence',
    rows.map((row) => row.recurringOccurrenceId).filter((id) => id !== null),
  );

  return {
    ...emptyResolver(),
    account: (localId) => accounts.get(localId),
    category: (localId) => categories.get(localId),
    person: (localId) => people.get(localId),
    recurringOccurrence: (localId) => occurrences.get(localId),
  };
}

/** A template names its account and category. */
function recurringTemplateResolver(entries: SyncOutboxEntry[]): RelationResolver {
  const rows = entries
    .map((entry) => readLocalRecurringTemplate(entry.entitySyncId))
    .filter((row) => row !== null);
  const accounts = readSyncIdsByLocalId(
    'account',
    rows.map((row) => row.accountId),
  );
  const categories = readSyncIdsByLocalId(
    'category',
    rows.map((row) => row.categoryId),
  );
  return {
    ...emptyResolver(),
    account: (localId) => accounts.get(localId),
    category: (localId) => categories.get(localId),
  };
}

/** An occurrence names only its template. */
function recurringOccurrenceResolver(entries: SyncOutboxEntry[]): RelationResolver {
  const rows = entries
    .map((entry) => readLocalRecurringOccurrence(entry.entitySyncId))
    .filter((row) => row !== null);
  const templates = readSyncIdsByLocalId(
    'recurring_template',
    rows.map((row) => row.templateId),
  );
  return {
    ...emptyResolver(),
    recurringTemplate: (localId) => templates.get(localId),
  };
}

/** A budget's only relation is its category, and the overall budget has none. */
function budgetResolver(entries: SyncOutboxEntry[]): RelationResolver {
  const rows = entries
    .map((entry) => readLocalBudget(entry.entitySyncId))
    .filter((row) => row !== null);
  const categories = readSyncIdsByLocalId(
    'category',
    rows.map((row) => row.categoryId).filter((id) => id !== null),
  );
  return {
    ...emptyResolver(),
    category: (localId) => categories.get(localId),
  };
}

function emptyResolver(): RelationResolver {
  const none = () => undefined;
  return {
    account: none,
    category: none,
    person: none,
    recurringTemplate: none,
    recurringOccurrence: none,
  };
}

function toRemoteError(error: unknown): PushRemoteError {
  return error instanceof PushRemoteError ? error : new PushRemoteError('remote_unknown');
}

function resolveStatus(input: {
  abortCode?: PushErrorCode;
  failures: PushFailure[];
  processed: number;
}): PushStatus {
  if (input.abortCode === 'network') return 'offline';
  if (input.abortCode === 'auth') return 'auth_required';
  if (input.abortCode === 'account_mismatch') return 'account_mismatch';
  if (input.abortCode !== undefined || input.failures.length > 0) return 'error';
  return input.processed === 0 ? 'idle' : 'success';
}

/**
 * Records push progress only. This is deliberately not a "last synced" marker:
 * pull does not exist, so the device cannot claim to be up to date.
 */
function recordRunOutcome(status: PushStatus, failures: PushFailure[]) {
  if (status === 'success') {
    updateSyncState({ lastSuccessfulPushAt: new Date(), lastSyncError: null });
    return;
  }
  const first = failures[0];
  if (first !== undefined) updateSyncState({ lastSyncError: first.code });
}

function defaultDependencies(): PushSyncDependencies {
  return {
    // Session lifetime and refresh belong to the auth layer; push only reads it.
    getAuthenticatedUserId: async () => {
      try {
        const session = await cloudAuthService.getSession();
        return session?.user.id ?? null;
      } catch {
        return null;
      }
    },
    createRemote: () => createSupabaseSyncRepository(),
  };
}
