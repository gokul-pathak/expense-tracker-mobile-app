import {
  CATEGORY_ALIAS_PATTERN,
  SUGGESTION_CONTRACT_VERSION,
  SUGGESTION_LIMITS,
  type SuggestionCategory,
  type SuggestionRequest,
} from './contract.ts';
import { cleanText, countLetters, hasMarkupOrLink, hasUnredactedIdentifier } from './text.ts';

/**
 * What the function accepts, checked before a provider is ever called.
 *
 * Strict in a particular way: an unknown field is a refusal, not something to
 * ignore. The exact fields a request may carry are the privacy promise, and a
 * server that quietly accepted `amountMinor` or `note` would let a future
 * client break that promise without anything failing.
 */

export type RequestValidation = { ok: true; request: SuggestionRequest } | { ok: false };

const REQUEST_KEYS = ['categories', 'merchantText', 'version'];
const CATEGORY_KEYS = ['id', 'name'];

export function validateSuggestionRequest(body: unknown): RequestValidation {
  if (!isPlainObject(body) || !hasExactKeys(body, REQUEST_KEYS)) return refused();
  if (body.version !== SUGGESTION_CONTRACT_VERSION) return refused();

  const merchantText = acceptableText(body.merchantText, SUGGESTION_LIMITS.merchantTextMax);
  // A merchant with fewer than two letters gives a model nothing to classify
  // except the categories themselves, which is a guess the app should not pay for.
  if (merchantText === null || countLetters(merchantText) < 2) return refused();
  if (hasUnredactedIdentifier(merchantText)) return refused();

  const { categories } = body;
  if (!Array.isArray(categories)) return refused();
  if (categories.length === 0 || categories.length > SUGGESTION_LIMITS.categoriesMax) {
    return refused();
  }

  const seen = new Set<string>();
  const accepted: SuggestionCategory[] = [];
  for (const candidate of categories) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, CATEGORY_KEYS)) return refused();
    const { id } = candidate;
    if (typeof id !== 'string' || !CATEGORY_ALIAS_PATTERN.test(id) || seen.has(id)) {
      return refused();
    }
    const name = acceptableText(candidate.name, SUGGESTION_LIMITS.categoryNameMax);
    if (name === null) return refused();
    seen.add(id);
    accepted.push({ id, name });
  }

  return {
    ok: true,
    request: { version: SUGGESTION_CONTRACT_VERSION, merchantText, categories: accepted },
  };
}

function acceptableText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanText(value);
  if (cleaned.length === 0 || cleaned.length > max) return null;
  if (hasMarkupOrLink(cleaned)) return null;
  return cleaned;
}

function refused(): RequestValidation {
  return { ok: false };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
