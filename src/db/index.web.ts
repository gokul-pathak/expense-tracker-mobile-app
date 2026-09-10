/**
 * The database is not opened in the web bundle.
 *
 * `expo-sqlite` runs SQLite as WebAssembly in the browser and its synchronous
 * API blocks the calling thread with `Atomics.wait` until a worker replies.
 * Browsers forbid `Atomics.wait` on the main thread and throw a `TypeError`
 * there, and cross-origin isolation does not change that — it only decides
 * whether `SharedArrayBuffer` exists at all. This app reads SQLite synchronously
 * throughout, so `openDatabaseSync` can never succeed on a web page.
 *
 * Without this file the native module runs at import time and throws while
 * modules are still loading, before React renders, which takes the whole web
 * bundle down. With it the app boots and every screen that needs data shows
 * `NativeDataNotice`, because `isLocalFinanceDataAvailable` is already false on
 * web and `features/ui/data.web.ts` already stubs every query.
 *
 * The mobile builds never load this file. `src/db/migrations.web.ts` is the
 * matching no-op for the initializer.
 */

const message = 'The local database is only available in the Android/iOS app.';

/**
 * Anything reaching a query on web is a missing `isLocalFinanceDataAvailable`
 * guard rather than something to paper over, so this throws instead of
 * returning empty results that would read as "you have no money".
 */
function unavailable(): never {
  throw new Error(message);
}

const unavailableTarget = new Proxy(
  {},
  {
    get: unavailable,
    apply: unavailable,
    set: unavailable,
  },
);

export const expoDb = unavailableTarget as never;
export const db = unavailableTarget as never;
