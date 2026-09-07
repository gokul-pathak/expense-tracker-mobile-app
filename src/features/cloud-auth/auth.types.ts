import type { Session, User } from '@supabase/supabase-js';

export type CloudAuthStatus =
  'unconfigured' | 'initializing' | 'signed_out' | 'signed_in' | 'error';

export type CloudAuthState = {
  status: CloudAuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;
};

export const INITIAL_CLOUD_AUTH_STATE: CloudAuthState = {
  status: 'initializing',
  user: null,
  session: null,
  error: null,
};
