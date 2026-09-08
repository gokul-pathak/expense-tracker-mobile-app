/**
 * A nudge for screens that are already on-screen when a pull changes SQLite.
 *
 * Screens reload on focus, which covers navigating back to one. It does not
 * cover standing on the Dashboard while a foreground sync brings in another
 * device's expense, so this lets them re-read the same local repositories they
 * always read. It carries no data of its own: the database remains the only
 * source, and this only says "read it again".
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSyncedDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSyncedDataChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A failing screen must never break the sync cycle that notified it.
    }
  }
}
