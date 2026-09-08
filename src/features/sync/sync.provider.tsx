import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { cloudAuthService } from '@/features/cloud-auth/auth.service';
import { useCloudAuth } from '@/features/cloud-auth/auth.provider';

import { emitSyncedDataChanged } from './sync-events';
import { readCloudSyncState, syncNow, type CloudSyncState, type SyncResult } from './sync.service';
import { isSyncEngineRunning } from './sync-lock';
import type { CloudSyncStatus } from './sync-status';

/**
 * The app's live view of cloud sync.
 *
 * It owns three things screens should not each reinvent: whether a cycle is
 * running, when the last one failed for a reason worth showing, and when it is
 * reasonable to start one automatically. Financial screens never consume this —
 * they read SQLite, which is exactly the point.
 *
 * This provider is mounted inside the App Lock gate, so a locked device runs no
 * synchronization at all and the first foreground sync happens after unlock.
 */

/**
 * How long to wait before another automatic sync. Rapid inactive/active
 * transitions are normal on both platforms — a notification shade, a permission
 * prompt — and each one is not a reason to talk to the network again.
 */
export const FOREGROUND_SYNC_INTERVAL_MS = 60_000;

type SyncContextValue = CloudSyncState & {
  syncing: boolean;
  /** True while a first-link reconciliation is running. */
  linking: boolean;
  lastResult: SyncResult | null;
  syncNow: () => Promise<SyncResult | null>;
  refresh: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  const { status: authStatus, user } = useCloudAuth();
  const authenticatedUserId = authStatus === 'signed_in' ? (user?.id ?? null) : null;
  const configured = cloudAuthService.isConfigured;

  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [version, setVersion] = useState(0);
  const lastAttemptAt = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const state = readSafeState({
    configured,
    authenticatedUserId,
    syncing,
    // A network failure is a state to show, not an error to raise.
    offline: lastResult?.status === 'offline',
    version,
  });

  const run = useCallback(async () => {
    if (isSyncEngineRunning()) return null;
    setSyncing(true);
    lastAttemptAt.current = Date.now();
    try {
      const result = await syncNow();
      if (!mounted.current) return result;
      setLastResult(result);
      // Screens that are already open re-read SQLite rather than being told
      // what changed.
      if (result.pulled > 0 || result.deleted > 0) emitSyncedDataChanged();
      return result;
    } catch {
      // A sync failure is never allowed to take the app down with it.
      return null;
    } finally {
      if (mounted.current) {
        setSyncing(false);
        refresh();
      }
    }
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Sync when the app becomes usable again, and only when it is worth doing.
  useEffect(() => {
    if (!configured || authenticatedUserId === null) return;
    const maybeSync = (appState: AppStateStatus) => {
      if (appState !== 'active') return;
      if (Date.now() - lastAttemptAt.current < FOREGROUND_SYNC_INTERVAL_MS) return;
      void run();
    };
    maybeSync(AppState.currentState);
    const subscription = AppState.addEventListener('change', maybeSync);
    return () => subscription.remove();
  }, [configured, authenticatedUserId, run]);

  return (
    <SyncContext
      value={{
        ...state,
        syncing,
        linking: isSyncEngineRunning('reconciliation'),
        lastResult,
        syncNow: run,
        refresh,
      }}
    >
      {children}
    </SyncContext>
  );
}

export function useCloudSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useCloudSync must be used inside SyncProvider.');
  return value;
}

/**
 * Reading durable sync state must never break a render. On a database that is
 * not ready the screen simply shows the local-only state.
 */
function readSafeState(input: {
  configured: boolean;
  authenticatedUserId: string | null;
  syncing: boolean;
  offline: boolean;
  version: number;
}): CloudSyncState {
  try {
    return readCloudSyncState(input);
  } catch {
    return {
      status: (input.configured ? 'local_only' : 'unconfigured') as CloudSyncStatus,
      linkedUserId: null,
      pendingChanges: 0,
      attentionRequired: 0,
      lastSuccessfulSyncAt: null,
      lastError: null,
      reconciliationRequired: false,
    };
  }
}
