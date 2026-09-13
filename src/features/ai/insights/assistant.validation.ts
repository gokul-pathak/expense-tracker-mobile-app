import { z } from 'zod';

import { normalizeSuggestionText } from '../expense-suggestion.sanitize';

import { allowedNumbersOf, ungroundedNumbers } from './assistant.grounding';
import { INSIGHT_OUTPUT_LIMITS, type InsightResult, type PreparedInsight } from './assistant.types';

/**
 * The app's own check of an explanation.
 *
 * All or nothing, like the server: a response that breaks any rule is an
 * invalid response and none of its text is shown. The rules: exactly the
 * expected fields; lengths and counts within bounds; plain text with no markup
 * or links; no claim to have changed a record; and no number the context this
 * device built does not contain.
 */

const responseSchema = z.strictObject({
  status: z.literal('ok'),
  explanation: z.strictObject({
    answer: z.string(),
    keyPoints: z.array(z.string()),
    caveats: z.array(z.string()),
  }),
  requestId: z.string().max(100),
  provider: z.string().max(40),
  model: z.string().max(100),
});

const CLAIMS_CHANGE =
  /\b(?:i|we)(?:'ve| have)? (?:added|created|recorded|logged|deleted|removed|updated|changed|edited|moved|transferred|scheduled|generated|skipped|cancelled|canceled)\b/i;

export function validateInsightResponse(body: unknown, prepared: PreparedInsight): InsightResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const { explanation, requestId, provider, model } = parsed.data;

  const answer = plain(explanation.answer, INSIGHT_OUTPUT_LIMITS.answerMax);
  const keyPoints = points(explanation.keyPoints, INSIGHT_OUTPUT_LIMITS.keyPointsMax);
  const caveats = points(explanation.caveats, INSIGHT_OUTPUT_LIMITS.caveatsMax);
  if (typeof answer !== 'string' || keyPoints === null || caveats === null) return invalid();

  const texts = [answer, ...keyPoints, ...caveats];
  if (texts.some((text) => CLAIMS_CHANGE.test(text))) return invalid();
  if (ungroundedNumbers(texts, allowedNumbersOf(prepared.request.context)).length > 0) {
    return invalid();
  }

  return {
    status: 'explained',
    explanation: { answer, keyPoints, caveats },
    meta: { requestId, provider, model },
  };
}

function points(values: string[], max: number): string[] | null {
  if (values.length > max) return null;
  const result: string[] = [];
  for (const value of values) {
    const text = plain(value, INSIGHT_OUTPUT_LIMITS.pointMax);
    if (text === undefined) return null;
    if (text !== null) result.push(text);
  }
  return result;
}

/** `null` for blank, `undefined` for unacceptable. */
function plain(value: string, max: number): string | null | undefined {
  const cleaned = normalizeSuggestionText(value)
    .replace(/\*\*|__/g, '')
    .replace(/^(?:[-*•]|#{1,6})\s+/, '')
    .trim();
  if (cleaned === '') return null;
  if (cleaned.length > max) return undefined;
  if (/[<>`]/.test(cleaned) || /(?:https?:\/\/|www\.)\S/i.test(cleaned)) return undefined;
  return cleaned;
}

function invalid(): InsightResult {
  return { status: 'failed', reason: 'invalid_response' };
}
