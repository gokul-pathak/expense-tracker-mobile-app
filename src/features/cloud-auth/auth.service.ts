import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabase/client';

export type CloudAuthClient = Pick<SupabaseClient, 'auth'>;

export function createCloudAuthService(client: CloudAuthClient | null = getSupabaseClient()) {
  return {
    isConfigured: client !== null,
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw toUserError(error);
      return data.session;
    },
    async signUp(email: string, password: string) {
      if (!client) throw new Error('Cloud Sync is not configured in this build.');
      const { data, error } = await client.auth.signUp({ email: normalizeEmail(email), password });
      if (error) throw toUserError(error);
      return { session: data.session, user: data.user };
    },
    async signIn(email: string, password: string) {
      if (!client) throw new Error('Cloud Sync is not configured in this build.');
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      if (error) throw toUserError(error);
      return data.session;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw toUserError(error);
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

type ProviderError = {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
};

/**
 * A provider failure as a sentence a person can act on.
 *
 * Supabase names most failures with a stable code; the message is the fallback
 * for a failure without one. Creating an account fails for reasons the person
 * can do something about — a weak password, too many confirmation emails, an
 * email the server would not send — and one generic sentence for all of them
 * left no way to tell. Anything unrecognised still gets the generic sentence,
 * never the provider's own text.
 */
function toUserError(error: ProviderError) {
  const code = error.code ?? '';
  const message = error.message.toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials'))
    return new Error('Invalid email or password.');
  if (code === 'email_not_confirmed' || message.includes('email not confirmed'))
    return new Error('Please confirm your email first.');
  // Deliberately the same sentence whether or not the address exists.
  if (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    message.includes('already registered')
  )
    return new Error('Unable to create an account with that email.');
  if (code === 'weak_password' || message.includes('password should'))
    return new Error('Choose a stronger password: at least 8 characters, and not a common one.');
  if (
    code === 'email_address_invalid' ||
    (message.includes('email address') && message.includes('invalid'))
  )
    return new Error('That email address cannot be used. Check it, or use another address.');
  if (
    code === 'signup_disabled' ||
    code === 'email_provider_disabled' ||
    message.includes('signups not allowed')
  )
    return new Error('New cloud accounts cannot be created right now.');
  if (code === 'over_email_send_rate_limit' || message.includes('email rate limit'))
    return new Error('Too many confirmation emails were requested. Wait a while, then try again.');
  if (code === 'over_request_rate_limit' || error.status === 429)
    return new Error('Too many attempts. Wait a few minutes, then try again.');
  if (code === 'email_address_not_authorized' || message.includes('error sending'))
    return new Error('The confirmation email could not be sent. Try again later.');
  if (message.includes('network') || message.includes('fetch')) {
    return new Error('Unable to connect right now.');
  }
  return new Error('Cloud Account request could not be completed.');
}
