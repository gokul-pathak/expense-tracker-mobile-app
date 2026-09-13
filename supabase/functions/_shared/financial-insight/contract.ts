/**
 * The wire contract for `explain-financial-insight`.
 *
 * The app builds a financial context from its own local database — figures the
 * domain services already calculated — and asks for a plain-language
 * explanation of it. The server holds no financial data and reads none: it
 * validates what it was sent, asks a provider to explain it, and checks the
 * answer against those same figures.
 *
 * Kept separate from the category-suggestion contract, and duplicated in the
 * app rather than imported: each side validates what it receives.
 */

export const INSIGHT_CONTRACT_VERSION = 1;
export const CONTEXT_VERSION = 1;

export const INSIGHT_LIMITS = {
  /** A question and a bounded context. Anything bigger is not one. */
  maxBodyBytes: 16_384,
  questionMax: 300,
  answerMax: 600,
  keyPointsMax: 4,
  caveatsMax: 3,
  pointMax: 200,
} as const;

export const CONTEXT_LIMITS = {
  currencies: 4,
  topCategories: 8,
  largestExpenses: 5,
  categoryChanges: 6,
  budgetCategories: 12,
  accounts: 12,
  people: 10,
  recurringItems: 10,
  recurringTotals: 8,
  notes: 4,
  nameMax: 40,
  descriptionMax: 40,
  labelMax: 60,
  noteMax: 160,
} as const;

export const INSIGHT_INTENTS = [
  'summary',
  'spending_categories',
  'largest_expenses',
  'trend',
  'budgets',
  'accounts',
  'lending',
  'recurring',
] as const;

export type InsightIntent = (typeof INSIGHT_INTENTS)[number];

export const CONTEXT_SECTIONS = [
  'summary',
  'categories',
  'largestExpenses',
  'trend',
  'budgets',
  'accounts',
  'lending',
  'recurring',
] as const;

export type ContextSectionName = (typeof CONTEXT_SECTIONS)[number];

/** A request carrying a section its intent does not use is refused. */
export const SECTIONS_FOR_INTENT: Readonly<Record<InsightIntent, readonly ContextSectionName[]>> = {
  summary: ['summary'],
  spending_categories: ['summary', 'categories'],
  largest_expenses: ['largestExpenses'],
  trend: ['trend'],
  budgets: ['budgets'],
  accounts: ['accounts'],
  lending: ['lending'],
  recurring: ['recurring'],
};

export const PERIOD_KINDS = [
  'today',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_year',
  'custom',
] as const;

/** A validated context: plain JSON whose every field has been checked. */
export type ValidatedContext = Record<string, unknown>;

export type InsightRequest = {
  version: typeof INSIGHT_CONTRACT_VERSION;
  intent: InsightIntent;
  question: string;
  context: ValidatedContext;
};

export type InsightExplanation = {
  answer: string;
  keyPoints: string[];
  caveats: string[];
};

export type InsightErrorCode =
  | 'method_not_allowed'
  | 'unauthenticated'
  | 'payload_too_large'
  | 'invalid_request'
  | 'rate_limited'
  | 'not_configured'
  | 'insight_unavailable'
  | 'invalid_provider_response'
  | 'timeout';

export type InsightResponseBody =
  | {
      status: 'ok';
      explanation: InsightExplanation;
      requestId: string;
      provider: string;
      model: string;
    }
  | { status: 'error'; code: InsightErrorCode; requestId: string };

export const INSIGHT_ERROR_STATUS: Record<InsightErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  payload_too_large: 413,
  invalid_request: 400,
  rate_limited: 429,
  not_configured: 503,
  insight_unavailable: 503,
  invalid_provider_response: 502,
  timeout: 504,
};
