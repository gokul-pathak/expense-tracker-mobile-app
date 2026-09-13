import { isPlainObject } from './request-validation.ts';

/**
 * Who is asking, decided from verified token claims — never from the request
 * body. Pure, so the rules are tested without a Supabase project.
 */

export type AuthenticatedCaller = { userId: string };

export type QuotaDecision = 'allowed' | 'limited' | 'unavailable';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A signed-in person, and only a signed-in person.
 *
 * The project's anon key is itself a valid JWT with `role: anon` and no
 * subject, and anonymous sign-ins produce `role: authenticated` with
 * `is_anonymous: true`. Neither is an account a quota can belong to, and an
 * endpoint that spends money on a provider must not be reachable by either.
 */
export function authenticatedCallerFromClaims(claims: unknown): AuthenticatedCaller | null {
  if (!isPlainObject(claims)) return null;
  if (claims.role !== 'authenticated') return null;
  if (claims.is_anonymous === true) return null;
  const { sub } = claims;
  if (typeof sub !== 'string' || !UUID.test(sub)) return null;
  return { userId: sub };
}

/** The quota function's answer. Anything unrecognised is treated as unavailable, never as allowed. */
export function quotaDecisionOf(data: unknown): QuotaDecision {
  if (isPlainObject(data) && typeof data.allowed === 'boolean') {
    return data.allowed ? 'allowed' : 'limited';
  }
  return 'unavailable';
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return match?.[1] ?? null;
}
