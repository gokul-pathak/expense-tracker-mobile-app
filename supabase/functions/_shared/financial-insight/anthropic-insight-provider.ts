import Anthropic from '@anthropic-ai/sdk';

import {
  ANTHROPIC_PROVIDER_ID,
  classifyAnthropicError,
  normalizeAnthropicMessage,
  supportsDefaultFallbacks,
} from '../expense-suggestion/anthropic-provider.ts';

import { buildInsightUserMessage, INSIGHT_OUTPUT_SCHEMA, INSIGHT_SYSTEM_PROMPT } from './prompt.ts';
import type { FinancialInsightProvider } from './provider.ts';

/**
 * Claude, explaining a financial context.
 *
 * One Messages API call with structured outputs — no tools, no files, no
 * images, no conversation history. The same normalisation as the suggestion
 * provider turns the SDK's message and errors into a provider-neutral outcome.
 *
 * - `effort: 'low'`: this rephrases figures that are already calculated. It
 *   needs no deep reasoning, and effort is the cost lever that matters.
 * - `max_tokens` of 2,048: room for a short answer and a few points, with
 *   adaptive thinking counted against the same limit.
 * - No sampling parameters. Current Claude models reject `temperature`; the
 *   determinism that matters here comes from the context, the schema and the
 *   numeric check on the answer, not from a sampling knob.
 * - `maxRetries: 1`, and `fallbacks: 'default'` where the model offers it.
 */

const MAX_TOKENS = 2_048;
const DEFAULT_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type AnthropicInsightProviderOptions = {
  apiKey: string;
  model: string;
  attemptTimeoutMs: number;
  fetch?: typeof fetch;
};

export function createAnthropicInsightProvider(
  options: AnthropicInsightProviderOptions,
): FinancialInsightProvider {
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
    async explain(request, signal) {
      try {
        const message = await client.beta.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: INSIGHT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildInsightUserMessage(request) }],
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: INSIGHT_OUTPUT_SCHEMA },
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
