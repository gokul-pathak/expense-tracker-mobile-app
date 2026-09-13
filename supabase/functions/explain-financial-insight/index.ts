import {
  INSIGHT_ATTEMPT_TIMEOUT_MS,
  INSIGHT_DEADLINE_MS,
  readServerConfig,
} from '../_shared/expense-suggestion/config.ts';
import { createSupabaseGate } from '../_shared/expense-suggestion/supabase-gate.ts';
import { createAnthropicInsightProvider } from '../_shared/financial-insight/anthropic-insight-provider.ts';
import {
  handleInsightRequest,
  type InsightLogEvent,
} from '../_shared/financial-insight/handler.ts';

/**
 * `explain-financial-insight`: plain-language explanations of figures the app
 * already calculated on the device.
 *
 * Wiring only; every decision is in `_shared/financial-insight`. Like the
 * suggestion function, `verify_jwt` is off in `supabase/config.toml` and the
 * handler verifies each caller itself. This function has no access to anyone's
 * financial records: it sees only the bounded context the app sends.
 */

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

const config = readServerConfig((name) => Deno.env.get(name));

const provider =
  config.insightProvider === 'anthropic' && config.anthropicApiKey !== null
    ? createAnthropicInsightProvider({
        apiKey: config.anthropicApiKey,
        model: config.insightModel,
        attemptTimeoutMs: INSIGHT_ATTEMPT_TIMEOUT_MS,
      })
    : null;

const gate =
  config.supabaseUrl !== null && config.supabasePublishableKey !== null
    ? createSupabaseGate(
        config.supabaseUrl,
        config.supabasePublishableKey,
        'consume_financial_insight_quota',
      )
    : null;

/** Technical metadata only: which sections were present, never what they held. */
function log(event: InsightLogEvent) {
  console.log(JSON.stringify({ function: 'explain-financial-insight', ...event }));
}

Deno.serve((request) =>
  handleInsightRequest(request, {
    provider,
    verifyUser: async (token) => (gate === null ? null : gate.verifyUser(token)),
    consumeQuota: async (token) => (gate === null ? 'unavailable' : gate.consumeQuota(token)),
    log,
    deadlineMs: INSIGHT_DEADLINE_MS,
  }),
);
