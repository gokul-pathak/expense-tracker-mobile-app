import type { ProviderOutcome } from '../expense-suggestion/provider.ts';

import type { InsightRequest } from './contract.ts';

/**
 * The boundary an AI provider sits behind for explanations.
 *
 * It receives the validated request and an abort signal — nothing else. No
 * tools, no database, no user identity, no way to ask for more. Its answer is
 * normalised into the same provider-neutral outcome the suggestion endpoint
 * uses, and validated by the handler before anyone sees it.
 */
export interface FinancialInsightProvider {
  readonly id: string;
  readonly model: string;
  explain(request: InsightRequest, signal: AbortSignal): Promise<ProviderOutcome>;
}
