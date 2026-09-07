import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { syncOutbox, syncState } from '@/db/schema';
import type { SyncEntityType, SyncOperation, SyncOutboxEntry } from '@/db/schema';

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
  const entitySyncId = requireSyncId(mutation.entitySyncId, `${mutation.entityType} record`);
  const pending = readPending(writer, mutation.entityType, entitySyncId);

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
export function acknowledgeSyncMutation(id: number, revision: number): boolean {
  return (
    db
      .delete(syncOutbox)
      .where(and(eq(syncOutbox.id, id), eq(syncOutbox.revision, revision)))
      .returning({ id: syncOutbox.id })
      .get() !== undefined
  );
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
): SyncOutboxEntry | null {
  return readPending(db, entityType, entitySyncId);
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

/** Restore replaces the whole local dataset, so stale queued work is dropped. */
export function clearSyncOutbox(writer: SyncWriter = db): void {
  writer.delete(syncOutbox).run();
}

export function getSyncState() {
  return readSyncState(db);
}

export function updateSyncState(
  patch: Partial<{
    linkedUserId: string | null;
    pullCursor: number | null;
    lastSuccessfulSyncAt: Date | null;
    lastSuccessfulPushAt: Date | null;
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
