import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { syncBaselines, syncConflicts } from '@/db/schema';
import type {
  SyncBaselineRecord,
  SyncConflictRecord,
  SyncConflictResolution,
  SyncEntityType,
  SyncOperation,
} from '@/db/schema';

import type { SyncWriter } from './sync.types';

/**
 * Per-record cloud knowledge.
 *
 * A baseline answers the one question conflict detection cannot answer from the
 * outbox: at which remote revision was this record last known to this device?
 * A pending outbox entry says a local change is waiting; only the baseline says
 * whether the cloud has moved on since that change was written.
 *
 * The `deleted` flag is also the tombstone registry. A delete that arrives for a
 * record this device never had leaves a marker here, so nothing later mistakes
 * the absence of a local row for the absence of a deletion.
 *
 * Local only. Nothing in this module talks to the cloud.
 */

export type SyncBaseline = SyncBaselineRecord;

export function readSyncBaseline(
  entityType: SyncEntityType,
  entitySyncId: string,
  writer: SyncWriter = db,
): SyncBaseline | null {
  return (
    writer
      .select()
      .from(syncBaselines)
      .where(
        and(eq(syncBaselines.entityType, entityType), eq(syncBaselines.entitySyncId, entitySyncId)),
      )
      .get() ?? null
  );
}

/** One query per entity type instead of one per record in a pull batch. */
export function readSyncBaselines(
  entityType: SyncEntityType,
  entitySyncIds: readonly string[],
  writer: SyncWriter = db,
): Map<string, SyncBaseline> {
  const resolved = new Map<string, SyncBaseline>();
  const unique = [...new Set(entitySyncIds)];
  if (unique.length === 0) return resolved;

  const rows = writer
    .select()
    .from(syncBaselines)
    .where(
      and(eq(syncBaselines.entityType, entityType), inArray(syncBaselines.entitySyncId, unique)),
    )
    .all();
  for (const row of rows) resolved.set(row.entitySyncId, row);
  return resolved;
}

/**
 * Records the remote revision this device has now accounted for.
 *
 * The revision never moves backwards: replaying an older change after a crash
 * must not make the device forget newer cloud state it already applied.
 */
export function recordSyncBaseline(
  input: {
    entityType: SyncEntityType;
    entitySyncId: string;
    serverRevision: number;
    deleted: boolean;
    appliedAt?: Date;
  },
  writer: SyncWriter = db,
): void {
  const appliedAt = input.appliedAt ?? new Date();
  writer
    .insert(syncBaselines)
    .values({
      entityType: input.entityType,
      entitySyncId: input.entitySyncId,
      serverRevision: input.serverRevision,
      deleted: input.deleted,
      appliedAt,
    })
    .onConflictDoUpdate({
      target: [syncBaselines.entityType, syncBaselines.entitySyncId],
      set: {
        serverRevision: sql`max(${syncBaselines.serverRevision}, ${input.serverRevision})`,
        deleted: input.deleted,
        appliedAt,
      },
    })
    .run();
}

/** True when the cloud is known to hold a tombstone for this identity. */
export function hasRemoteTombstone(
  entityType: SyncEntityType,
  entitySyncId: string,
  writer: SyncWriter = db,
): boolean {
  return readSyncBaseline(entityType, entitySyncId, writer)?.deleted === true;
}

export type SyncConflictInput = {
  entityType: SyncEntityType;
  entitySyncId: string;
  localOperation: SyncOperation | null;
  baseServerRevision: number | null;
  remoteServerRevision: number;
  resolution: SyncConflictResolution;
  /** Compact technical reason code. Never a financial value. */
  detail?: string | null;
  detectedAt?: Date;
};

export function recordSyncConflict(input: SyncConflictInput, writer: SyncWriter = db): void {
  writer
    .insert(syncConflicts)
    .values({
      entityType: input.entityType,
      entitySyncId: input.entitySyncId,
      localOperation: input.localOperation,
      baseServerRevision: input.baseServerRevision,
      remoteServerRevision: input.remoteServerRevision,
      resolution: input.resolution,
      detail: input.detail ?? null,
      detectedAt: input.detectedAt ?? new Date(),
    })
    .run();
}

export function listSyncConflicts(limit = 100): SyncConflictRecord[] {
  return db.select().from(syncConflicts).orderBy(desc(syncConflicts.id)).limit(limit).all();
}

export function countSyncConflicts(resolution?: SyncConflictResolution): number {
  const result = db
    .select({ total: sql<number>`count(*)` })
    .from(syncConflicts)
    .where(resolution === undefined ? undefined : eq(syncConflicts.resolution, resolution))
    .get();
  return result?.total ?? 0;
}

/** Restore replaces the local dataset, so cloud knowledge about it no longer holds. */
export function clearSyncBaselines(writer: SyncWriter = db): void {
  writer.delete(syncBaselines).run();
  writer.delete(syncConflicts).run();
}
