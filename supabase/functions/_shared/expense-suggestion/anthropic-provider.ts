import Anthropic from '@anthropic-ai/sdk';

import { buildOutputSchema, buildUserMessage, SYSTEM_PROMPT } from './prompt.ts';
import type {
  ExpenseSuggestionProvider,
  ProviderFailure,
  ProviderOutcome,
  ProviderUsage,
} from './provider.ts';

/**
 * Claude, behind the provider boundary.
 *
 * One Messages API call with structured outputs, no tools, no files, no images
 * and no conversation history. Everything provider-shaped — the SDK message,
 * its stop reason, its error classes — is turned into a `ProviderOutcome` here
 * and goes no further.
 *
 * Configuration choices, each for a small classification task:
 *
 * - `effort: 'low'`. Choosing one of a dozen categories from a merchant name
 *   does not repay deeper reasoning, and effort is the main cost lever.
 * - `max_tokens` of 1,024. The answer is a four-field object, but adaptive
 *   thinking counts against the same limit, and a truncated answer is thrown
 *   away whole.
 * - `maxRetries: 1`. The SDK retries 408/409/429/5xx and connection failures
 *   once. The handler's deadline bounds the total, so a retry can never keep
 *   the person waiting past it.
 * - `fallbacks: 'default'` on models that support it, so a request declined by
 *   a safety classifier is re-run on Anthropic's recommended fallback instead
 *   of failing. If the whole chain declines, that is `refused`: no suggestion.
 *
 * The model is not hard-coded here: `config.ts` reads it from the deployment's
 * environment, so it can be changed without shipping the app.
 */

export const ANTHROPIC_PROVIDER_ID = 'anthropic';

const MAX_TOKENS = 1_024;
const DEFAULT_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  /** Per attempt. The handler's deadline caps attempts and the retry together. */
  attemptTimeoutMs: number;
  /** Injected by tests, so no test ever reaches the network. */
  fetch?: typeof fetch;
};

export function createAnthropicSuggestionProvider(
  options: AnthropicProviderOptions,
): ExpenseSuggestionProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.attemptTimeoutMs,
    maxRetries: 1,
    fetch: options.fetch,
  });
  const { model } = options;
  const withFallbacks = supportsDefaultFallbacks(model);

  return {
    id: ANTHROPIC_PROVIDER_ID,
    model,
    async suggest(request, signal) {
      try {
        const message = await client.beta.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserMessage(request) }],
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: buildOutputSchema(request) },
            },
            ...(withFallbacks
              ? { betas: [DEFAULT_FALLBACK_BETA], fallbacks: 'default' as const }
              : {}),
          },
          { signal },
        );
        return normalizeAnthropicMessage(message);
      } catch (error) {
        return { kind: 'failure', failure: classifyAnthropicError(error), usage: null };
      }
    },
  };
}

/** The server-side `default` fallback chain is offered for these model families. */
export function supportsDefaultFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable-5-1)(?:$|-)/.test(model);
}

/** The parts of a Messages API response this provider reads. */
export type AnthropicMessageLike = {
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
};

export function normalizeAnthropicMessage(message: AnthropicMessageLike): ProviderOutcome {
  const usage = usageOf(message);
  switch (message.stop_reason) {
    case 'refusal':
      return { kind: 'failure', failure: 'refused', usage };
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return { kind: 'failure', failure: 'truncated', usage };
    case 'end_turn':
      break;
    default:
      // A tool call, a pause, anything this request cannot produce. Handed on
      // as an empty output so validation refuses it rather than guessing.
      return { kind: 'output', value: null, usage };
  }

  const text = message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  try {
    return { kind: 'output', value: JSON.parse(text) as unknown, usage };
  } catch {
    // Prose instead of JSON. Never parsed for a category — validation refuses it.
    return { kind: 'output', value: text, usage };
  }
}

export function classifyAnthropicError(error: unknown): ProviderFailure {
  // Our own deadline aborted the request.
  if (error instanceof Anthropic.APIUserAbortError) return 'timeout';
  // A subclass of APIConnectionError, so it must be checked first.
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return 'misconfigured';
  }
  return 'unavailable';
}

function usageOf(message: AnthropicMessageLike): ProviderUsage | null {
  const input = message.usage?.input_tokens;
  const output = message.usage?.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  return { inputTokens: input, outputTokens: output };
}
