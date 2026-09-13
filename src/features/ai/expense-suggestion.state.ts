import type {
  AiExpenseSuggestionResult,
  ExpenseSuggestion,
  SuggestionFailureReason,
} from './expense-suggestion.types';

/**
 * A suggestion's life beside one form, as a pure reducer.
 *
 * Nothing here holds or changes form values. The form's category is the
 * form's; this only knows what was suggested. That separation is what makes
 * "a suggestion alone is not a selection" true by construction rather than by
 * care: there is no event that sets a category.
 *
 * `run` is the stale-result guard, as in the scanner. Every request and every
 * cancellation bumps it, and a result carrying an older run changes nothing —
 * so a slow answer for receipt A can never appear on receipt B, and an answer
 * that arrives after Save Expense is simply dropped.
 */

/**
 * Requests one form may make, retries included. A ceiling on accidental loops,
 * not a limit anyone should reach by using the app.
 */
export const MAX_SUGGESTION_ATTEMPTS = 3;

export type SuggestionPhase =
  | { status: 'idle' }
  | { status: 'loading'; fingerprint: string }
  | { status: 'ready'; fingerprint: string; suggestion: ExpenseSuggestion }
  | { status: 'no_suggestion'; fingerprint: string }
  | { status: 'failed'; fingerprint: string; reason: SuggestionFailureReason }
  /** The form no longer wants a suggestion — it saved, or it closed. */
  | { status: 'stopped' };

export type SuggestionState = {
  run: number;
  attempts: number;
  phase: SuggestionPhase;
  categoryDismissed: boolean;
  merchantDismissed: boolean;
};

export type SuggestionEvent =
  | { type: 'request'; fingerprint: string }
  | { type: 'retry'; fingerprint: string }
  | { type: 'finished'; run: number; fingerprint: string; result: AiExpenseSuggestionResult }
  | { type: 'cancel' }
  | { type: 'dismiss_category' }
  | { type: 'dismiss_merchant' };

export const initialSuggestionState: SuggestionState = {
  run: 0,
  attempts: 0,
  phase: { status: 'idle' },
  categoryDismissed: false,
  merchantDismissed: false,
};

export function suggestionReducer(state: SuggestionState, event: SuggestionEvent): SuggestionState {
  const { phase } = state;

  switch (event.type) {
    case 'request':
      if (phase.status === 'stopped') return state;
      // Asked already for this context: loading, answered, or failed. Renders,
      // refocuses and category reloads all arrive here and send nothing. A
      // failure is never retried automatically.
      if (phase.status !== 'idle' && phase.fingerprint === event.fingerprint) return state;
      if (state.attempts >= MAX_SUGGESTION_ATTEMPTS) return state;
      return {
        run: state.run + 1,
        attempts: state.attempts + 1,
        phase: { status: 'loading', fingerprint: event.fingerprint },
        categoryDismissed: false,
        merchantDismissed: false,
      };

    case 'retry':
      if (phase.status !== 'failed' || phase.fingerprint !== event.fingerprint) return state;
      if (!isRetryableFailure(phase.reason) || state.attempts >= MAX_SUGGESTION_ATTEMPTS) {
        return state;
      }
      return {
        ...state,
        run: state.run + 1,
        attempts: state.attempts + 1,
        phase: { status: 'loading', fingerprint: event.fingerprint },
      };

    case 'finished': {
      if (event.run !== state.run) return state;
      if (phase.status !== 'loading' || phase.fingerprint !== event.fingerprint) return state;
      const { fingerprint } = phase;
      const { result } = event;
      switch (result.status) {
        case 'suggested':
          return {
            ...state,
            phase: { status: 'ready', fingerprint, suggestion: result.suggestion },
          };
        case 'no_suggestion':
          return { ...state, phase: { status: 'no_suggestion', fingerprint } };
        case 'failed':
          return result.reason === 'cancelled'
            ? { ...state, phase: { status: 'stopped' } }
            : { ...state, phase: { status: 'failed', fingerprint, reason: result.reason } };
      }
      return state;
    }

    case 'cancel':
      // Anything in flight is now stale, and nothing new starts.
      if (phase.status === 'stopped') return state;
      return { ...state, run: state.run + 1, phase: { status: 'stopped' } };

    case 'dismiss_category':
      return state.categoryDismissed ? state : { ...state, categoryDismissed: true };

    case 'dismiss_merchant':
      return state.merchantDismissed ? state : { ...state, merchantDismissed: true };
  }
}

/** Failures a second try might fix. A quota or a missing sign-in will not change by tapping. */
export function isRetryableFailure(reason: SuggestionFailureReason): boolean {
  return (
    reason === 'timeout' ||
    reason === 'network' ||
    reason === 'unavailable' ||
    reason === 'invalid_response'
  );
}

export function canRetrySuggestion(state: SuggestionState): boolean {
  return (
    state.phase.status === 'failed' &&
    isRetryableFailure(state.phase.reason) &&
    state.attempts < MAX_SUGGESTION_ATTEMPTS
  );
}
