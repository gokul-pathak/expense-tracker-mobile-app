/**
 * The vocabulary of AI expense suggestions.
 *
 * One rule shapes every type here: **a suggestion is advice about an unsaved
 * form, never a change to money.** Nothing in this feature can create, edit or
 * delete a transaction, and nothing here is persisted, backed up or synced. A
 * suggestion lives in memory beside the form it was asked for, and it becomes
 * part of an expense only if a person taps it and then presses Save.
 */

export const SUGGESTION_CONTRACT_VERSION = 1;

/**
 * The app's own copy of the server's limits. Deliberately not imported from
 * the server: each side checks what it receives.
 */
export const SUGGESTION_LIMITS = {
  merchantTextMax: 80,
  categoryNameMax: 40,
  categoriesMax: 60,
  outputMerchantMax: 60,
  outputReasonMax: 160,
} as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type SuggestionConfidence = (typeof CONFIDENCE_LEVELS)[number];

/** The built-in catch-all. A low-confidence "Other" is no suggestion at all. */
export const OTHER_EXPENSE_SYSTEM_KEY = 'expense_other';

/**
 * Everything a suggestion may be built from. One field, and it is not money.
 *
 * No amount, currency, date, account, note, payment mode, image or OCR text:
 * a merchant name is what a category depends on, and the rest would only be
 * more of someone's life sent somewhere for no better answer.
 */
export type ExpenseSuggestionContext = {
  merchantCandidate: string | null;
};

/** A currently selectable expense category, as the form knows it. */
export type CategoryCandidate = {
  id: number;
  name: string;
  systemKey: string | null;
};

/** Exactly what leaves the device. The server refuses any other field. */
export type ExpenseSuggestionRequest = {
  version: typeof SUGGESTION_CONTRACT_VERSION;
  merchantText: string;
  categories: { id: string; name: string }[];
};

export type PreparedSuggestion = {
  request: ExpenseSuggestionRequest;
  /** Request-scoped alias (`c1`…) → the category it stands for. Never sent. */
  categories: Readonly<Record<string, CategoryCandidate>>;
  /** The receipt's own reading, normalised, to tell a real merchant suggestion from an echo. */
  detectedMerchant: string;
  /** Identifies this draft's context without holding its text. */
  fingerprint: string;
};

export type PrepareOutcome =
  | { kind: 'ready'; prepared: PreparedSuggestion }
  | { kind: 'skipped'; reason: 'no_merchant' | 'no_categories' | 'too_many_categories' };

/** A validated suggestion, mapped back onto this device's categories. */
export type ExpenseSuggestion = {
  categoryId: number | null;
  normalizedMerchant: string | null;
  confidence: SuggestionConfidence;
  reason: string | null;
};

export type SuggestionFailureReason =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'unauthenticated'
  | 'not_configured'
  | 'cancelled';

/** Diagnostics only. Never shown to a person and never stored. */
export type SuggestionMeta = { requestId: string; provider: string; model: string };

export type AiExpenseSuggestionResult =
  | { status: 'suggested'; suggestion: ExpenseSuggestion; meta: SuggestionMeta }
  | { status: 'no_suggestion'; meta: SuggestionMeta }
  | { status: 'failed'; reason: SuggestionFailureReason };

/** What a transport hands back: an untrusted body, or a classified failure. */
export type ProviderResponse =
  { kind: 'response'; body: unknown } | { kind: 'failure'; reason: SuggestionFailureReason };

/**
 * Where suggestions come from. The app ships one — the project's Edge
 * Function — and tests use fakes. No implementation may hold a provider
 * secret: the app never talks to an AI provider directly.
 */
export interface AiExpenseSuggestionProvider {
  readonly id: string;
  isAvailable(): boolean;
  suggest(
    request: ExpenseSuggestionRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<ProviderResponse>;
}
