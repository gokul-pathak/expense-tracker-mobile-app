import type { SuggestionRequest } from './contract.ts';

/**
 * The boundary every AI provider sits behind.
 *
 * The handler never sees an SDK response object, a provider-specific stop
 * reason or a vendor error message. A provider turns all of that into one of
 * the outcomes below, and nothing else crosses.
 *
 * A provider receives the validated request and an abort signal — nothing
 * more. It has no tools, no database handle, no user identity and no way to
 * ask for more context.
 */

export type ProviderFailure =
  /** The provider throttled this deployment. Not the person's own quota. */
  | 'rate_limited'
  /** 5xx, overload, network. Transient from the app's point of view. */
  | 'unavailable'
  | 'timeout'
  /** The provider declined to answer. A safe outcome: no suggestion. */
  | 'refused'
  /** Output was cut off before it was complete, so none of it is used. */
  | 'truncated'
  /** A bad key, a bad model id, a malformed request. A deployment problem. */
  | 'misconfigured';

export type ProviderUsage = { inputTokens: number; outputTokens: number };

export type ProviderOutcome =
  /** Parsed JSON when the text was JSON; the raw text otherwise. Unvalidated either way. */
  | { kind: 'output'; value: unknown; usage: ProviderUsage | null }
  | { kind: 'failure'; failure: ProviderFailure; usage: ProviderUsage | null };

export interface ExpenseSuggestionProvider {
  readonly id: string;
  readonly model: string;
  suggest(request: SuggestionRequest, signal: AbortSignal): Promise<ProviderOutcome>;
}
