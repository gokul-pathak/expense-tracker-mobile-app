import { hasExactKeys, isPlainObject } from '../expense-suggestion/request-validation.ts';
import { cleanText, hasMarkupOrLink } from '../expense-suggestion/text.ts';

import { INSIGHT_LIMITS, type InsightExplanation, type InsightRequest } from './contract.ts';
import { allowedNumbers, ungroundedNumbers } from './grounding.ts';

/**
 * Whether an explanation may be returned, checked against the request it
 * explains.
 *
 * All or nothing. A missing or extra field, an answer or point over its length,
 * too many points, markup or a link, a claim to have changed a record, or a
 * number the context does not contain — any one rejects the whole explanation.
 * The app then shows the figures it calculated, without prose.
 */

export type InsightOutputValidation = { ok: true; explanation: InsightExplanation } | { ok: false };

const OUTPUT_KEYS = ['answer', 'caveats', 'keyPoints'];

/** "I have added…", "I've deleted…": an agent's claim this service can never truthfully make. */
const CLAIMS_CHANGE =
  /\b(?:i|we)(?:'ve| have)? (?:added|created|recorded|logged|deleted|removed|updated|changed|edited|moved|transferred|scheduled|generated|skipped|cancelled|canceled)\b/i;

export function validateInsightOutput(
  value: unknown,
  request: InsightRequest,
): InsightOutputValidation {
  if (!isPlainObject(value) || !hasExactKeys(value, OUTPUT_KEYS)) return { ok: false };

  const answer = plain(value.answer, INSIGHT_LIMITS.answerMax);
  const keyPoints = points(value.keyPoints, INSIGHT_LIMITS.keyPointsMax);
  const caveats = points(value.caveats, INSIGHT_LIMITS.caveatsMax);
  if (typeof answer !== 'string' || keyPoints === null || caveats === null) return { ok: false };

  const texts = [answer, ...keyPoints, ...caveats];
  if (texts.some((text) => CLAIMS_CHANGE.test(text))) return { ok: false };
  if (ungroundedNumbers(texts, allowedNumbers(request.context)).length > 0) return { ok: false };

  return { ok: true, explanation: { answer, keyPoints, caveats } };
}

function points(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = plain(item, INSIGHT_LIMITS.pointMax);
    if (text === undefined) return null;
    if (text !== null) result.push(text);
  }
  return result;
}

/** `null` for blank, `undefined` for unacceptable. Emphasis and list markers are removed. */
function plain(value: unknown, max: number): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = cleanText(value)
    .replace(/\*\*|__/g, '')
    .replace(/^(?:[-*•]|#{1,6})\s+/, '')
    .trim();
  if (cleaned === '') return null;
  if (cleaned.length > max || hasMarkupOrLink(cleaned)) return undefined;
  return cleaned;
}
