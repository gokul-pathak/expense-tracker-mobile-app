import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabase/client';

export type CloudAuthClient = Pick<SupabaseClient, 'auth'>;

export function createCloudAuthService(client: CloudAuthClient | null = getSupabaseClient()) {
  return {
    isConfigured: client !== null,
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw toUserError(error.message);
      return data.session;
    },
    async signUp(email: string, password: string) {
      if (!client) throw new Error('Cloud Sync is not configured in this build.');
      const { data, error } = await client.auth.signUp({ email: normalizeEmail(email), password });
      if (error) throw toUserError(error.message);
      return { session: data.session, user: data.user };
    },
    async signIn(email: string, password: string) {
      if (!client) throw new Error('Cloud Sync is not configured in this build.');
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      if (error) throw toUserError(error.message);
      return data.session;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw toUserError(error.message);
    },
    onAuthStateChange(listener: Parameters<SupabaseClient['auth']['onAuthStateChange']>[0]) {
      if (!client) return { unsubscribe: () => undefined };
      return client.auth.onAuthStateChange(listener).data.subscription;
    },
  };
}

export const cloudAuthService = createCloudAuthService();

function normalizeEmail(email: string) {
  return email.trim();
}

function toUserError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials'))
    return new Error('Invalid email or password.');
  if (normalized.includes('email not confirmed'))
    return new Error('Please confirm your email first.');
  if (normalized.includes('already registered'))
    return new Error('Unable to create an account with that email.');
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return new Error('Unable to connect right now.');
  }
  return new Error('Cloud Account request could not be completed.');
}
