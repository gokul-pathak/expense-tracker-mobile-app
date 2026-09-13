import type {
  FinancialAssistantContext,
  InsightIntent,
} from '@/features/insights/financial-context.types';

/**
 * The app's side of the Spending Insights explanation contract.
 *
 * An explanation is presentation. The figures it talks about were calculated
 * on the device before anything was sent, and the screen shows them itself; an
 * explanation adds sentences around them and nothing else. This feature can
 * read a context it is handed and a response it receives. It cannot read the
 * database, and it cannot change a record.
 */

export const INSIGHT_CONTRACT_VERSION = 1;

/** The app's own copy of the output limits. Not imported from the server: each side checks. */
export const INSIGHT_OUTPUT_LIMITS = {
  answerMax: 600,
  keyPointsMax: 4,
  caveatsMax: 3,
  pointMax: 200,
} as const;

/** Below the server's 16 KB, so a request the app sends is never one the server must refuse. */
export const INSIGHT_REQUEST_MAX_BYTES = 14_000;

/** Exactly what leaves the device. */
export type InsightRequest = {
  version: typeof INSIGHT_CONTRACT_VERSION;
  intent: InsightIntent;
  question: string;
  context: FinancialAssistantContext;
};

export type InsightExplanation = {
  answer: string;
  keyPoints: string[];
  caveats: string[];
};

export type InsightFailureReason =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'unauthenticated'
  | 'not_configured'
  | 'cancelled';

/** Diagnostics only. Never shown and never stored. */
export type InsightMeta = { requestId: string; provider: string; model: string };

export type InsightResult =
  | { status: 'explained'; explanation: InsightExplanation; meta: InsightMeta }
  | { status: 'failed'; reason: InsightFailureReason };

export type InsightProviderResponse =
  { kind: 'response'; body: unknown } | { kind: 'failure'; reason: InsightFailureReason };

export type PreparedInsight = {
  request: InsightRequest;
  /** Identifies this question over this context without keeping either in the key. */
  fingerprint: string;
};

/** Where explanations come from. The app ships one — the project's Edge Function. */
export interface AiFinancialInsightProvider {
  readonly id: string;
  isAvailable(): boolean;
  explain(
    request: InsightRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<InsightProviderResponse>;
}
