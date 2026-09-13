import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabase/client';

import type {
  AiExpenseSuggestionProvider,
  SuggestionFailureReason,
} from './expense-suggestion.types';

/**
 * The app's one route to an AI suggestion: the project's own Edge Function.
 *
 * This file is the only network call in the AI feature. It holds no provider
 * key and knows no provider: the function does, server-side. The Supabase
 * client attaches the signed-in session's access token, and the function
 * verifies it; a user id is never sent.
 *
 * Without a configured project — Local Only builds, and every automated test —
 * `isAvailable` is false and nothing is ever sent.
 */

export const EXPENSE_SUGGESTION_FUNCTION = 'suggest-expense-category';

type ClientSource = typeof getSupabaseClient;

export function createSupabaseSuggestionProvider(
  getClient: ClientSource = getSupabaseClient,
): AiExpenseSuggestionProvider {
  return {
    id: 'supabase-edge-function',
    isAvailable: () => getClient() !== null,
    async suggest(request, { signal, timeoutMs }) {
      const client = getClient();
      if (client === null) return { kind: 'failure', reason: 'not_configured' };
      const { data, error } = await client.functions.invoke(EXPENSE_SUGGESTION_FUNCTION, {
        body: request,
        signal,
        timeout: timeoutMs,
      });
      if (error === null) return { kind: 'response', body: data as unknown };
      return { kind: 'failure', reason: failureOf(error, signal) };
    },
  };
}

export const supabaseSuggestionProvider = createSupabaseSuggestionProvider();

function failureOf(error: unknown, signal: AbortSignal): SuggestionFailureReason {
  if (signal.aborted) return 'cancelled';
  if (error instanceof FunctionsHttpError) {
    const response = error.context as { status?: unknown } | undefined;
    return failureForStatus(typeof response?.status === 'number' ? response.status : 0);
  }
  if (error instanceof FunctionsFetchError) {
    // The client's own timeout aborts the fetch; nothing else here does.
    const cause = error.context as { name?: unknown } | undefined;
    return cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'timeout' : 'network';
  }
  if (error instanceof FunctionsRelayError) return 'unavailable';
  return 'network';
}

/** The function's HTTP status, as a reason. Response bodies are never shown. */
export function failureForStatus(status: number): SuggestionFailureReason {
  switch (status) {
    case 401:
    case 403:
      return 'unauthenticated';
    case 429:
      return 'rate_limited';
    case 502:
      return 'invalid_response';
    case 504:
      return 'timeout';
    default:
      return 'unavailable';
  }
}
