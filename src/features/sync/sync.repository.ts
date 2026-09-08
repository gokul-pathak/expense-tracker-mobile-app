import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { syncOutbox, syncState } from '@/db/schema';
import type { SyncEntityType, SyncOperation, SyncOutboxEntry } from '@/db/schema';

import { clearSyncBaselines, readSyncBaseline } from './sync-baseline.repository';
import { areUserMutationsSuspended, MutationsSuspendedError } from './sync-lock';
import type { SyncMutation, SyncWriter } from './sync.types';
import { requireSyncId } from './uuid';

const SINGLETON_ID = 1;
const MAX_ERROR_CODE_LENGTH = 120;

/**
 * Record one pending cloud mutation for a locally changed row.
 *
 * The caller must pass the same transaction as its domain mutation so the two
 * commit or roll back together. Remote apply and migrations never call this.
 */
export function enqueueSyncMutation(writer: SyncWriter, mutation: SyncMutation): void {
  // Only user-originated writes reach here, which makes this the one place that
  // can hold them back while a reconciliation captures or replaces the whole
  // dataset. Remote apply and migrations are unaffected by design.
  if (areUserMutationsSuspended()) throw new MutationsSuspendedError();
  const entitySyncId = requireSyncId(mutation.entitySyncId, `${mutation.entityType} record`);
  const pending = readPending(writer, mutation.entityType, entitySyncId);
  // The revision this local change is written on top of. Pull compares the
  // revision it downloads against this to tell a plain remote update from a
  // record that genuinely moved on both devices.
  const baseServerRevision =
    readSyncBaseline(mutation.entityType, entitySyncId, writer)?.serverRevision ?? null;

  if (mutation.operation === 'delete') {
    // A row the cloud has never seen needs no tombstone: cancel the pending work.
    if (pending?.operation === 'upsert' && hasNeverPushed(writer)) {
      writer.delete(syncOutbox).where(eq(syncOutbox.id, pending.id)).run();
      return;
    }
  } else if (pending?.operation === 'delete') {
    // A tombstone is never downgraded to an upsert by a later local write.
    return;
  }

  if (pending) {
    // Coalesce onto the existing entry, keeping its queue position stable. The
    // revision bump tells an in-flight push that this entry is newer than what
    // it uploaded, so acknowledgement will leave the new intent pending.
    writer
      .update(syncOutbox)
      .set({
        operation: mutation.operation,
        revision: sql`${syncOutbox.revision} + 1`,
        // The local row now incorporates every remote change applied so far, so
        // the newest baseline is this mutation's base.
        baseServerRevision,
        attemptCount: 0,
        lastAttemptAt: null,
        lastError: null,
      })
      .where(eq(syncOutbox.id, pending.id))
      .run();
    return;
  }

  writer
    .insert(syncOutbox)
    .values({
      entityType: mutation.entityType,
      entitySyncId,
      operation: mutation.operation,
      createdAt: mutation.createdAt ?? new Date(),
      revision: 1,
      baseServerRevision,
      attemptCount: 0,
    })
    .run();
}

/**
 * Pending work for one push phase, in queue order.
 *
 * `excludeIds` skips entries that already failed in the current push run so a
 * run cannot loop forever on the same blocked operation.
 */
export function listPendingSyncMutationsForPush(filter: {
  entityTypes: readonly SyncEntityType[];
  operations: readonly SyncOperation[];
  limit: number;
  excludeIds?: readonly number[];
}): SyncOutboxEntry[] {
  if (filter.entityTypes.length === 0 || filter.operations.length === 0) return [];
  return db
    .select()
    .from(syncOutbox)
    .where(
      and(
        inArray(syncOutbox.entityType, [...filter.entityTypes]),
        inArray(syncOutbox.operation, [...filter.operations]),
        filter.excludeIds === undefined || filter.excludeIds.length === 0
          ? undefined
          : notInArray(syncOutbox.id, [...filter.excludeIds]),
      ),
    )
    .orderBy(asc(syncOutbox.createdAt), asc(syncOutbox.id))
    .limit(filter.limit)
    .all();
}

/**
 * Removes one entry after the cloud confirmed exactly this work.
 *
 * The revision guard is the reason a local edit made while a push was in flight
 * is never lost: a coalesced entry has a newer revision and stays pending.
 * Returns whether the entry was removed.
 */
export function acknowledgeSyncMutation(
  id: number,
  revision: number,
  writer: SyncWriter = db,
): boolean {
  return (
    writer
      .delete(syncOutbox)
      .where(and(eq(syncOutbox.id, id), eq(syncOutbox.revision, revision)))
      .returning({ id: syncOutbox.id })
      .get() !== undefined
  );
}

/**
 * Moves a pending mutation's base to a remote revision Pull Sync has accounted
 * for, so the same remote change is not re-detected as a conflict on every run.
 * The revision guard keeps a newer local edit untouched.
 */
export function setPendingSyncMutationBase(
  id: number,
  revision: number,
  baseServerRevision: number,
  writer: SyncWriter = db,
): void {
  writer
    .update(syncOutbox)
    .set({ baseServerRevision })
    .where(and(eq(syncOutbox.id, id), eq(syncOutbox.revision, revision)))
    .run();
}

/**
 * Repoints queued work at a new global identity.
 *
 * Two records legitimately change identity when the cloud is reconciled: the
 * settings singleton, whose real cloud identity is the owning user, and a
 * built-in category matched by `system_key`. Queued local intent must follow the
 * record rather than be orphaned on an identity that no longer exists.
 */
export function rekeySyncMutation(
  entityType: SyncEntityType,
  fromSyncId: string,
  toSyncId: string,
  writer: SyncWriter = db,
): void {
  if (fromSyncId === toSyncId) return;
  const pending = readPending(writer, entityType, fromSyncId);
  if (pending === null) return;

  // The unique (entity_type, entity_sync_id) index allows only one live entry.
  writer
    .delete(syncOutbox)
    .where(and(eq(syncOutbox.entityType, entityType), eq(syncOutbox.entitySyncId, toSyncId)))
    .run();
  writer
    .update(syncOutbox)
    .set({ entitySyncId: toSyncId })
    .where(eq(syncOutbox.id, pending.id))
    .run();
}

/** Pending operations in deterministic push order. */
export function listPendingSyncMutations(limit = 100): SyncOutboxEntry[] {
  return db
    .select()
    .from(syncOutbox)
    .orderBy(asc(syncOutbox.createdAt), asc(syncOutbox.id))
    .limit(limit)
    .all();
}

export function countPendingSyncMutations(): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(syncOutbox)
    .get();
  return result?.total ?? 0;
}

export function getPendingSyncMutation(
  entityType: SyncEntityType,
  entitySyncId: string,
  writer: SyncWriter = db,
): SyncOutboxEntry | null {
  return readPending(writer, entityType, entitySyncId);
}

/** Pending work for a whole pull batch in one query per entity type. */
export function readPendingSyncMutations(
  entityType: SyncEntityType,
  entitySyncIds: readonly string[],
  writer: SyncWriter = db,
): Map<string, SyncOutboxEntry> {
  const pending = new Map<string, SyncOutboxEntry>();
  const unique = [...new Set(entitySyncIds)];
  if (unique.length === 0) return pending;

  const rows = writer
    .select()
    .from(syncOutbox)
    .where(and(eq(syncOutbox.entityType, entityType), inArray(syncOutbox.entitySyncId, unique)))
    .all();
  for (const row of rows) pending.set(row.entitySyncId, row);
  return pending;
}

/**
 * Records a failed push attempt.
 *
 * The revision guard keeps this from overwriting a newer local mutation that
 * coalesced onto the entry while the attempt was in flight.
 */
export function markSyncAttempt(
  id: number,
  errorCode?: string | null,
  options: { revision?: number; attemptedAt?: Date } = {},
): void {
  db.update(syncOutbox)
    .set({
      attemptCount: sql`${syncOutbox.attemptCount} + 1`,
      lastAttemptAt: options.attemptedAt ?? new Date(),
      lastError: normalizeErrorCode(errorCode),
    })
    .where(
      options.revision === undefined
        ? eq(syncOutbox.id, id)
        : and(eq(syncOutbox.id, id), eq(syncOutbox.revision, options.revision)),
    )
    .run();
}

/** Removes one entry after the cloud has acknowledged it. No push exists yet. */
export function removeAcknowledgedSyncMutation(id: number): void {
  db.delete(syncOutbox).where(eq(syncOutbox.id, id)).run();
}

/** Drops queued work whose dataset no longer exists. */
export function clearSyncOutbox(writer: SyncWriter = db): void {
  writer.delete(syncOutbox).run();
}

/**
 * Drops everything this device believes about the cloud.
 *
 * Used when the dataset underneath those beliefs was replaced — a backup
 * restore, or unlinking — because a baseline that describes rows which no longer
 * exist would make the next conflict comparison meaningless.
 */
export function clearCloudKnowledge(writer: SyncWriter = db): void {
  clearSyncOutbox(writer);
  clearSyncBaselines(writer);
}

export function getSyncState() {
  return readSyncState(db);
}

export type CloudBinding = {
  /** The account this database has finished agreeing with. */
  linkedUserId: string | null;
  /** The account a reconciliation is currently working towards. */
  pendingLinkUserId: string | null;
  /** True while the local dataset was replaced under a link and needs a choice. */
  reconciliationRequired: boolean;
};

export function getCloudBinding(writer: SyncWriter = db): CloudBinding {
  const state = readSyncState(writer);
  return {
    linkedUserId: state?.linkedUserId ?? null,
    pendingLinkUserId: state?.pendingLinkUserId ?? null,
    reconciliationRequired: state?.reconciliationRequired ?? false,
  };
}

/**
 * The account the sync engines may act for.
 *
 * Ordinary push and pull accept only a committed link. Reconciliation passes
 * `acceptPendingLink` so it can converge a database it is still in the middle of
 * binding, without that half-finished state ever looking like a real link.
 */
export function resolveSyncableUserId(
  authenticatedUserId: string,
  options: { acceptPendingLink?: boolean } = {},
  writer: SyncWriter = db,
):
  | { ok: true }
  | { ok: false; reason: 'not_linked' | 'account_mismatch' | 'reconciliation_required' } {
  const binding = getCloudBinding(writer);
  if (binding.reconciliationRequired && options.acceptPendingLink !== true) {
    return { ok: false, reason: 'reconciliation_required' };
  }
  const bound =
    binding.linkedUserId ?? (options.acceptPendingLink === true ? binding.pendingLinkUserId : null);
  if (bound === null) return { ok: false, reason: 'not_linked' };
  if (bound !== authenticatedUserId) return { ok: false, reason: 'account_mismatch' };
  return { ok: true };
}

/**
 * Removes the cloud binding while keeping every financial record.
 *
 * Domain rows and their global identities stay exactly as they are, so the data
 * remains usable offline and can be reconciled again later. What goes is
 * everything that describes a relationship with one cloud account: the binding,
 * the cursor, the per-record baselines and the progress markers. Queued local
 * work is deliberately kept — it is the user's unsent intent, and unlinking is
 * not a reason to discard it.
 */
export function clearCloudBinding(writer: SyncWriter = db): void {
  updateSyncState(
    {
      linkedUserId: null,
      pendingLinkUserId: null,
      reconciliationRequired: false,
      pullCursor: null,
      lastSuccessfulSyncAt: null,
      lastSuccessfulPushAt: null,
      lastSuccessfulPullAt: null,
      lastSyncError: null,
    },
    writer,
  );
  clearSyncBaselines(writer);
}

export function updateSyncState(
  patch: Partial<{
    linkedUserId: string | null;
    pendingLinkUserId: string | null;
    reconciliationRequired: boolean;
    pullCursor: number | null;
    lastSuccessfulSyncAt: Date | null;
    lastSuccessfulPushAt: Date | null;
    lastSuccessfulPullAt: Date | null;
    lastSyncError: string | null;
  }>,
  writer: SyncWriter = db,
) {
  ensureSyncState(writer);
  writer.update(syncState).set(patch).where(eq(syncState.singletonId, SINGLETON_ID)).run();
  return readSyncState(writer);
}

export function ensureSyncState(writer: SyncWriter = db): void {
  writer
    .insert(syncState)
    .values({ singletonId: SINGLETON_ID })
    .onConflictDoNothing({ target: syncState.singletonId })
    .run();
}

function readSyncState(writer: SyncWriter) {
  return (
    writer.select().from(syncState).where(eq(syncState.singletonId, SINGLETON_ID)).get() ?? null
  );
}

function readPending(writer: SyncWriter, entityType: SyncEntityType, entitySyncId: string) {
  return (
    writer
      .select()
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entityType, entityType), eq(syncOutbox.entitySyncId, entitySyncId)))
      .get() ?? null
  );
}

/**
 * True while this database has never been bound to a cloud account, which is
 * the only state in which the cloud provably cannot know any local row.
 */
function hasNeverPushed(writer: SyncWriter): boolean {
  return (
    writer
      .select({ singletonId: syncState.singletonId })
      .from(syncState)
      .where(and(eq(syncState.singletonId, SINGLETON_ID), isNull(syncState.linkedUserId)))
      .get() !== undefined
  );
}

function normalizeErrorCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_ERROR_CODE_LENGTH);
}
