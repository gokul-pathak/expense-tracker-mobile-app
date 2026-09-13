/**
 * The wire contract between the app and the `suggest-expense-category` function.
 *
 * The app keeps its own copy of these rules in `src/features/ai` rather than
 * importing this file. That duplication is the point: a client that trusts the
 * server completely has no defence left if the server, or the model behind it,
 * is ever wrong. Each side validates what it receives.
 *
 * Runtime-agnostic on purpose — no Deno globals and no npm imports — so the
 * same code runs in the Edge Function and in the Node test suite.
 */

export const SUGGESTION_CONTRACT_VERSION = 1;

export const SUGGESTION_LIMITS = {
  /** A request is a merchant name and a category list. Anything bigger is not one. */
  maxBodyBytes: 8_192,
  merchantTextMax: 80,
  categoryNameMax: 40,
  categoriesMax: 60,
  outputMerchantMax: 60,
  outputReasonMax: 160,
} as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type SuggestionConfidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Request-scoped aliases: `c1`, `c2`… assigned by the app for one request.
 *
 * Not the category's database id or sync id. An alias means nothing outside
 * the request that carried it, so nothing stable about a person's categories
 * reaches the provider, and a returned id can only be checked against the set
 * this exact request supplied.
 */
export const CATEGORY_ALIAS_PATTERN = /^c[1-9][0-9]{0,2}$/;

export type SuggestionCategory = { id: string; name: string };

export type SuggestionRequest = {
  version: typeof SUGGESTION_CONTRACT_VERSION;
  merchantText: string;
  categories: SuggestionCategory[];
};

/** What the model is asked for, and the only shape it is allowed to return. */
export type SuggestionOutput = {
  categoryId: string | null;
  merchantName: string | null;
  confidence: SuggestionConfidence;
  reason: string | null;
};

export type SuggestionErrorCode =
  | 'method_not_allowed'
  | 'unauthenticated'
  | 'payload_too_large'
  | 'invalid_request'
  | 'rate_limited'
  | 'not_configured'
  | 'suggestion_unavailable'
  | 'invalid_provider_response'
  | 'timeout';

export type SuggestionResponseBody =
  | {
      status: 'ok';
      suggestion: SuggestionOutput;
      requestId: string;
      provider: string;
      model: string;
    }
  | { status: 'error'; code: SuggestionErrorCode; requestId: string };

export const ERROR_STATUS: Record<SuggestionErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  payload_too_large: 413,
  invalid_request: 400,
  rate_limited: 429,
  not_configured: 503,
  suggestion_unavailable: 503,
  invalid_provider_response: 502,
  timeout: 504,
};
