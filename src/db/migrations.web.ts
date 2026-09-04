/**
 * Expo SQLite web support requires cross-origin isolation for SharedArrayBuffer.
 * The mobile database is intentionally not initialized in the web bundle.
 */
export function initializeDatabase() {
  return Promise.resolve();
}
