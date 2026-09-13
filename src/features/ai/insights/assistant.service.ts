import type {
  FinancialAssistantContext,
  InsightIntent,
} from '@/features/insights/financial-context.types';

import { fingerprintOf, redactSensitiveText } from '../expense-suggestion.sanitize';

import {
  INSIGHT_CONTRACT_VERSION,
  INSIGHT_REQUEST_MAX_BYTES,
  type AiFinancialInsightProvider,
  type InsightProviderResponse,
  type InsightResult,
  type PreparedInsight,
} from './assistant.types';
import { validateInsightResponse } from './assistant.validation';

/**
 * Asking for an explanation of figures the device already calculated.
 *
 * `prepare…` decides exactly what would be sent; `request…` sends it once and
 * validates the answer. Neither reads the database or reaches a record: the
 * caller hands over a context the domain services built, and receives prose.
 */

export const CLIENT_INSIGHT_TIMEOUT_MS = 15_000;
export const INSIGHT_WIRE_QUESTION_MAX = 300;

export type PrepareInsightOutcome =
  { kind: 'ready'; prepared: PreparedInsight } | { kind: 'empty' } | { kind: 'too_large' };

export function prepareInsightRequest(input: {
  question: string;
  intent: InsightIntent;
  context: FinancialAssistantContext;
}): PrepareInsightOutcome {
  // Phone numbers, card numbers and email addresses typed into a question are
  // not needed to explain a total.
  const question = redactSensitiveText(input.question).slice(0, INSIGHT_WIRE_QUESTION_MAX).trim();
  if (question === '') return { kind: 'empty' };

  const request: PreparedInsight['request'] = {
    version: INSIGHT_CONTRACT_VERSION,
    intent: input.intent,
    question,
    context: input.context,
  };
  const wire = JSON.stringify(request);
  if (utf8Length(wire) > INSIGHT_REQUEST_MAX_BYTES) return { kind: 'too_large' };

  return {
    kind: 'ready',
    prepared: {
      request,
      fingerprint: fingerprintOf([
        String(INSIGHT_CONTRACT_VERSION),
        input.intent,
        question.toLowerCase(),
        JSON.stringify(input.context),
      ]),
    },
  };
}

/** Sends once, validates, never throws, never retries on its own. */
export async function requestFinancialInsight(
  prepared: PreparedInsight,
  provider: AiFinancialInsightProvider,
  options: { signal: AbortSignal },
): Promise<InsightResult> {
  const { signal } = options;
  if (signal.aborted) return { status: 'failed', reason: 'cancelled' };
  if (!provider.isAvailable()) return { status: 'failed', reason: 'not_configured' };

  let response: InsightProviderResponse;
  try {
    response = await provider.explain(prepared.request, {
      signal,
      timeoutMs: CLIENT_INSIGHT_TIMEOUT_MS,
    });
  } catch {
    response = { kind: 'failure', reason: 'network' };
  }

  if (signal.aborted) return { status: 'failed', reason: 'cancelled' };
  if (response.kind === 'failure') return { status: 'failed', reason: response.reason };
  return validateInsightResponse(response.body, prepared);
}

/** UTF-8 byte length, counted by hand so it behaves the same on Hermes and in Node. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
