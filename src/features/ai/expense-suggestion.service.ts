import {
  categoryNameForAi,
  fingerprintOf,
  merchantTextForAi,
  normalizeSuggestionText,
} from './expense-suggestion.sanitize';
import {
  SUGGESTION_CONTRACT_VERSION,
  SUGGESTION_LIMITS,
  type AiExpenseSuggestionProvider,
  type AiExpenseSuggestionResult,
  type CategoryCandidate,
  type ExpenseSuggestionContext,
  type PrepareOutcome,
  type ProviderResponse,
} from './expense-suggestion.types';
import { validateSuggestionResponse } from './expense-suggestion.validation';

/**
 * Asking for a suggestion, from form context to validated advice.
 *
 * Two steps, kept apart so each can be tested alone: `prepare…` decides exactly
 * what would be sent (or that nothing should be), and `request…` sends it once
 * and checks the answer. Neither reads the database, and neither can reach a
 * transaction: the caller supplies the categories, and receives advice back.
 */

/**
 * Long enough for the server's own nine-second deadline to answer first, short
 * enough that "Finding a category suggestion…" never lingers.
 */
export const CLIENT_SUGGESTION_TIMEOUT_MS = 12_000;

/**
 * Builds the request, or explains why there is none.
 *
 * `scope` names the form the suggestion is for (`receipt:42`), so two drafts
 * with the same merchant never share a suggestion.
 */
export function prepareExpenseSuggestion(
  context: ExpenseSuggestionContext,
  categories: readonly CategoryCandidate[],
  scope: string,
): PrepareOutcome {
  const merchantText = merchantTextForAi(context.merchantCandidate);
  // No merchant, no request. An amount alone is not worth guessing from.
  if (merchantText === null) return { kind: 'skipped', reason: 'no_merchant' };

  const usable = [...categories]
    .sort((a, b) => a.id - b.id)
    .flatMap((candidate) => {
      const name = categoryNameForAi(candidate.name);
      return name === null ? [] : [{ candidate, name }];
    });
  if (usable.length === 0) return { kind: 'skipped', reason: 'no_categories' };
  if (usable.length > SUGGESTION_LIMITS.categoriesMax) {
    return { kind: 'skipped', reason: 'too_many_categories' };
  }

  const byAlias: Record<string, CategoryCandidate> = {};
  const requestCategories = usable.map(({ candidate, name }, index) => {
    const id = `c${index + 1}`;
    byAlias[id] = candidate;
    return { id, name };
  });

  return {
    kind: 'ready',
    prepared: {
      // Every field named, so nothing can ride along by spreading an object.
      request: {
        version: SUGGESTION_CONTRACT_VERSION,
        merchantText,
        categories: requestCategories,
      },
      categories: byAlias,
      detectedMerchant: normalizeSuggestionText(context.merchantCandidate ?? ''),
      fingerprint: fingerprintOf([String(SUGGESTION_CONTRACT_VERSION), scope, merchantText]),
    },
  };
}

/**
 * Sends one request and validates the answer. Never throws, never retries on
 * its own: a retry is something a person asks for.
 */
export async function requestExpenseSuggestion(
  prepared: Extract<PrepareOutcome, { kind: 'ready' }>['prepared'],
  provider: AiExpenseSuggestionProvider,
  options: { signal: AbortSignal },
): Promise<AiExpenseSuggestionResult> {
  const { signal } = options;
  if (signal.aborted) return { status: 'failed', reason: 'cancelled' };
  if (!provider.isAvailable()) return { status: 'failed', reason: 'not_configured' };

  let response: ProviderResponse;
  try {
    response = await provider.suggest(prepared.request, {
      signal,
      timeoutMs: CLIENT_SUGGESTION_TIMEOUT_MS,
    });
  } catch {
    response = { kind: 'failure', reason: 'network' };
  }

  // Whatever came back, a request its form no longer wants is not an answer.
  if (signal.aborted) return { status: 'failed', reason: 'cancelled' };
  if (response.kind === 'failure') return { status: 'failed', reason: response.reason };
  return validateSuggestionResponse(response.body, prepared);
}
