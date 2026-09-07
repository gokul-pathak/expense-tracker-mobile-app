import { AppState, type AppStateStatus } from 'react-native';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { getSupabaseClient } from '@/lib/supabase/client';

import { cloudAuthService } from './auth.service';
import { INITIAL_CLOUD_AUTH_STATE, type CloudAuthState, type CloudAuthStatus } from './auth.types';

type CloudAuthContextValue = CloudAuthState & { refresh: () => Promise<void> };

const CloudAuthContext = createContext<CloudAuthContextValue | null>(null);

export function CloudAuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<CloudAuthState>(
    cloudAuthService.isConfigured
      ? INITIAL_CLOUD_AUTH_STATE
      : { status: 'unconfigured', user: null, session: null, error: null },
  );

  async function refresh() {
    if (!cloudAuthService.isConfigured) return;
    try {
      const session = await cloudAuthService.getSession();
      setState({
        status: session ? 'signed_in' : 'signed_out',
        user: session?.user ?? null,
        session,
        error: null,
      });
    } catch {
      // The existing local app stays available if secure session restoration fails.
      setState({
        status: 'error',
        user: null,
        session: null,
        error: 'Cloud Account is unavailable.',
      });
    }
  }

  useEffect(() => {
    if (!cloudAuthService.isConfigured) return;
    const initialization = setTimeout(() => void refresh(), 0);
    const subscription = cloudAuthService.onAuthStateChange(async (_event, session) => {
      setState({
        status: session ? 'signed_in' : 'signed_out',
        user: session?.user ?? null,
        session,
        error: null,
      });
    });
    return () => {
      clearTimeout(initialization);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    const updateRefresh = (appState: AppStateStatus) => {
      if (appState === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    updateRefresh(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateRefresh);
    return () => subscription.remove();
  }, []);

  return <CloudAuthContext value={{ ...state, refresh }}>{children}</CloudAuthContext>;
}

export function useCloudAuth() {
  const value = useContext(CloudAuthContext);
  if (!value) throw new Error('useCloudAuth must be used inside CloudAuthProvider.');
  return value;
}

export function isSignedIn(status: CloudAuthStatus) {
  return status === 'signed_in';
}
