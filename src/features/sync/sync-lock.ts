/**
 * One synchronization engine at a time, in this process.
 *
 * Push and Pull both read the outbox, the per-record baselines and the sync
 * cursor, and both decide what to do from what they read. Letting them
 * interleave would let one act on state the other has already superseded — for
 * example acknowledging a queue entry a conflict resolution has just replaced.
 *
 * This is a convenience, not the correctness mechanism. Durable correctness
 * comes from the outbox, the revision guards and identity-keyed idempotency,
 * all of which survive a process restart that this flag does not.
 */

export const SYNC_ENGINES = ['push', 'pull'] as const;

export type SyncEngine = (typeof SYNC_ENGINES)[number];

let holder: SyncEngine | null = null;

export function currentSyncEngine(): SyncEngine | null {
  return holder;
}

export function isSyncEngineRunning(engine?: SyncEngine): boolean {
  return engine === undefined ? holder !== null : holder === engine;
}

/**
 * Runs `execute` while holding the lock. If another engine already holds it,
 * `whenBusy` produces the caller's own "already running" result instead: a
 * synchronization run is skippable work, never something to queue up.
 */
export async function withSyncEngineLock<T>(
  engine: SyncEngine,
  execute: () => Promise<T>,
  whenBusy: (current: SyncEngine) => T,
): Promise<T> {
  if (holder !== null) return whenBusy(holder);
  holder = engine;
  try {
    return await execute();
  } finally {
    holder = null;
  }
}
