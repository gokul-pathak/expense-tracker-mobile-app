/**
 * One synchronization engine at a time, in this process.
 *
 * Push and Pull both read the outbox, the per-record baselines and the sync
 * cursor, and both decide what to do from what they read. Letting them
 * interleave would let one act on state the other has already superseded — for
 * example acknowledging a queue entry a conflict resolution has just replaced.
 * Reconciliation is the third engine, and the only one that also suspends the
 * user's own writes while it runs.
 *
 * This is a convenience, not the correctness mechanism. Durable correctness
 * comes from the outbox, the revision guards and identity-keyed idempotency,
 * all of which survive a process restart that this flag does not.
 */

export const SYNC_ENGINES = ['push', 'pull', 'reconciliation'] as const;

export type SyncEngine = (typeof SYNC_ENGINES)[number];

let holder: SyncEngine | null = null;
let userMutationsSuspended = false;

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
 *
 * Reconciliation is the exception, because it is built *from* the other two: a
 * first link uploads and then pulls to converge. Those nested runs proceed under
 * the lock reconciliation already holds, while a second reconciliation — or an
 * independent push or pull — is still turned away.
 */
export async function withSyncEngineLock<T>(
  engine: SyncEngine,
  execute: () => Promise<T>,
  whenBusy: (current: SyncEngine) => T,
): Promise<T> {
  if (holder === 'reconciliation' && engine !== 'reconciliation') return execute();
  if (holder !== null) return whenBusy(holder);
  holder = engine;
  try {
    return await execute();
  } finally {
    holder = null;
  }
}

/**
 * True while a reconciliation is capturing or replacing the whole dataset.
 *
 * A record created between "snapshot taken" and "upload finished" would be
 * silently absent from the cloud, and a record created during a local
 * replacement would be destroyed by it. Both are prevented by refusing user
 * mutations for the short critical section rather than by hoping the timing
 * never happens.
 */
export function areUserMutationsSuspended(): boolean {
  return userMutationsSuspended;
}

export class MutationsSuspendedError extends Error {
  constructor() {
    super('Cloud sync setup is in progress. Your changes can be saved in a moment.');
    this.name = 'MutationsSuspendedError';
  }
}

/** Runs `execute` with user writes suspended, releasing them however it ends. */
export async function withUserMutationsSuspended<T>(execute: () => Promise<T>): Promise<T> {
  userMutationsSuspended = true;
  try {
    return await execute();
  } finally {
    userMutationsSuspended = false;
  }
}
