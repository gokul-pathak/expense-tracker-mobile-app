import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabase/client';

import { failureForStatus } from '../supabase-expense-suggestion.provider';

import type { AiFinancialInsightProvider, InsightFailureReason } from './assistant.types';

/**
 * Explanations from the project's own Edge Function.
 *
 * The only network call in Spending Insights. It holds no provider key and
 * knows no provider. The Supabase client attaches the signed-in session's
 * access token; no user id, email or device id is sent. Without a configured
 * project — Local Only builds, and every automated test — `isAvailable` is
 * false and nothing leaves the device.
 */

export const FINANCIAL_INSIGHT_FUNCTION = 'explain-financial-insight';

export function createSupabaseInsightProvider(
  getClient: typeof getSupabaseClient = getSupabaseClient,
): AiFinancialInsightProvider {
  return {
    id: 'supabase-edge-function',
    isAvailable: () => getClient() !== null,
    async explain(request, { signal, timeoutMs }) {
      const client = getClient();
      if (client === null) return { kind: 'failure', reason: 'not_configured' };
      const { data, error } = await client.functions.invoke(FINANCIAL_INSIGHT_FUNCTION, {
        body: request,
        signal,
        timeout: timeoutMs,
      });
      if (error === null) return { kind: 'response', body: data as unknown };
      return { kind: 'failure', reason: failureOf(error, signal) };
    },
  };
}

export const supabaseInsightProvider = createSupabaseInsightProvider();

function failureOf(error: unknown, signal: AbortSignal): InsightFailureReason {
  if (signal.aborted) return 'cancelled';
  if (error instanceof FunctionsHttpError) {
    const response = error.context as { status?: unknown } | undefined;
    return failureForStatus(typeof response?.status === 'number' ? response.status : 0);
  }
  if (error instanceof FunctionsFetchError) {
    const cause = error.context as { name?: unknown } | undefined;
    return cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'timeout' : 'network';
  }
  if (error instanceof FunctionsRelayError) return 'unavailable';
  return 'network';
}
