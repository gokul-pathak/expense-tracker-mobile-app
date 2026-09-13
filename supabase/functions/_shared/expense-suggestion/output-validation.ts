import {
  CONFIDENCE_LEVELS,
  SUGGESTION_LIMITS,
  type SuggestionConfidence,
  type SuggestionOutput,
  type SuggestionRequest,
} from './contract.ts';
import { hasExactKeys, isPlainObject } from './request-validation.ts';
import { cleanText, hasMarkupOrLink } from './text.ts';

/**
 * Whether what the provider returned may be passed on, checked against the
 * request that asked for it.
 *
 * **All or nothing.** Any violation — a missing field, an unknown field, a
 * confidence outside the enum, a category the request did not supply, a
 * merchant or reason over its length, markup, a link — rejects the whole
 * output. A response that got one thing wrong is not trusted for the rest:
 * a model that returned an injected category id may well have returned an
 * injected merchant name beside it.
 *
 * Structured outputs make most of these unreachable. This is what holds when
 * they are not honoured, when a provider is swapped, or when a model is
 * steered by the text it was given.
 */

export type OutputValidation = { ok: true; output: SuggestionOutput } | { ok: false };

const OUTPUT_KEYS = ['categoryId', 'confidence', 'merchantName', 'reason'];

export function validateProviderOutput(
  value: unknown,
  request: SuggestionRequest,
): OutputValidation {
  if (!isPlainObject(value) || !hasExactKeys(value, OUTPUT_KEYS)) return { ok: false };

  const { categoryId, confidence } = value;
  if (categoryId !== null) {
    if (typeof categoryId !== 'string') return { ok: false };
    if (!request.categories.some((category) => category.id === categoryId)) return { ok: false };
  }
  if (!isConfidence(confidence)) return { ok: false };

  const merchantName = optionalText(value.merchantName, SUGGESTION_LIMITS.outputMerchantMax);
  const reason = optionalText(value.reason, SUGGESTION_LIMITS.outputReasonMax);
  if (merchantName === undefined || reason === undefined) return { ok: false };

  return { ok: true, output: { categoryId, merchantName, confidence, reason } };
}

function isConfidence(value: unknown): value is SuggestionConfidence {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

/** `null` for absent or blank, `undefined` for unacceptable. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = cleanText(value);
  if (cleaned.length === 0) return null;
  if (cleaned.length > max || hasMarkupOrLink(cleaned)) return undefined;
  return cleaned;
}
