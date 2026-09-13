import { createAnthropicSuggestionProvider } from '../_shared/expense-suggestion/anthropic-provider.ts';
import {
  PROVIDER_ATTEMPT_TIMEOUT_MS,
  readServerConfig,
  SUGGESTION_DEADLINE_MS,
} from '../_shared/expense-suggestion/config.ts';
import {
  handleSuggestionRequest,
  type SuggestionLogEvent,
} from '../_shared/expense-suggestion/handler.ts';
import { createSupabaseGate } from '../_shared/expense-suggestion/supabase-gate.ts';

/**
 * `suggest-expense-category`: the app's only AI endpoint.
 *
 * Wiring and nothing else. Every decision lives in `_shared/expense-suggestion`,
 * where it runs under the Node test suite too. `verify_jwt` is off for this
 * function in `supabase/config.toml` because the gateway's legacy check does not
 * support asymmetric signing keys; the handler verifies every caller itself.
 */

// The Deno global, declared narrowly so this file also type-checks under the
// app's TypeScript. At runtime it is Deno's own.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

const config = readServerConfig((name) => Deno.env.get(name));

const provider =
  config.provider === 'anthropic' && config.anthropicApiKey !== null
    ? createAnthropicSuggestionProvider({
        apiKey: config.anthropicApiKey,
        model: config.model,
        attemptTimeoutMs: PROVIDER_ATTEMPT_TIMEOUT_MS,
      })
    : null;

const gate =
  config.supabaseUrl !== null && config.supabasePublishableKey !== null
    ? createSupabaseGate(config.supabaseUrl, config.supabasePublishableKey)
    : null;

/** Technical metadata only. The event has no field that could carry receipt text. */
function log(event: SuggestionLogEvent) {
  console.log(JSON.stringify({ function: 'suggest-expense-category', ...event }));
}

Deno.serve((request) =>
  handleSuggestionRequest(request, {
    provider,
    verifyUser: async (token) => (gate === null ? null : gate.verifyUser(token)),
    consumeQuota: async (token) => (gate === null ? 'unavailable' : gate.consumeQuota(token)),
    log,
    deadlineMs: SUGGESTION_DEADLINE_MS,
  }),
);
