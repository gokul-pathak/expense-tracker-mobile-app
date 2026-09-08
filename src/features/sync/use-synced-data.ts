import { useEffect } from 'react';

import { onSyncedDataChanged } from './sync-events';

/**
 * Re-runs a screen's own loader when a sync brings in new local data.
 *
 * Screens already reload on focus, which covers navigating back to one. This
 * covers standing on a screen while a foreground sync lands another device's
 * change. The screen re-reads SQLite exactly as it always does — nothing about
 * the cloud reaches the render path.
 */
export function useRefreshOnSyncedData(reload: () => void): void {
  useEffect(() => onSyncedDataChanged(reload), [reload]);
}
