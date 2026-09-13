import { createClient } from '@supabase/supabase-js';

import { authenticatedCallerFromClaims, quotaDecisionOf, type QuotaDecision } from './auth.ts';

/**
 * Identity and quota, using the project's own Auth and Postgres.
 *
 * Built from the publishable key only. No service-role or secret key is used
 * or needed: the token is verified with `auth.getClaims` (locally against the
 * project's JWKS when signing keys are asymmetric), and the quota is consumed
 * by calling a database function *as the caller*, so Postgres derives the
 * user from the verified JWT itself and no user id is ever passed in.
 */

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export type SupabaseGate = {
  verifyUser(token: string): Promise<{ userId: string } | null>;
  consumeQuota(token: string): Promise<QuotaDecision>;
};

/** Each AI endpoint has its own quota function, so one feature cannot spend the other's allowance. */
export type QuotaFunction = 'consume_expense_suggestion_quota' | 'consume_financial_insight_quota';

export function createSupabaseGate(
  url: string,
  publishableKey: string,
  quotaFunction: QuotaFunction = 'consume_expense_suggestion_quota',
): SupabaseGate {
  const verifier = createClient(url, publishableKey, NO_SESSION);

  return {
    async verifyUser(token) {
      const { data, error } = await verifier.auth.getClaims(token);
      if (error !== null || data === null) return null;
      return authenticatedCallerFromClaims(data.claims);
    },
    async consumeQuota(token) {
      const asCaller = createClient(url, publishableKey, {
        ...NO_SESSION,
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await asCaller.rpc(quotaFunction);
      return error !== null ? 'unavailable' : quotaDecisionOf(data);
    },
  };
}
