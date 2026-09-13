import type { InsightExplanation, InsightFailureReason, InsightResult } from './assistant.types';

/**
 * One question's AI explanation, as a pure reducer.
 *
 * The figures behind a question are never here: the screen holds them, built
 * on the device. This tracks only whether an explanation was asked for, is on
 * its way, arrived or failed — and makes sure a late one cannot land on the
 * wrong question.
 *
 * `run` is the stale-result guard. Every ask, retry, cancel and clear bumps it;
 * a result carrying an older run changes nothing. So question A's slow answer
 * never appears under question B, and nothing appears after the person leaves
 * or changes the period.
 */

/** Explanation requests for one question, retries included. */
export const MAX_ATTEMPTS_PER_QUESTION = 3;
/** Explanation requests in one visit to the screen. A ceiling on loops, not on use. */
export const MAX_SESSION_REQUESTS = 20;

export type AssistantPhase =
  | { status: 'idle' }
  | { status: 'loading'; fingerprint: string }
  | { status: 'explained'; fingerprint: string; explanation: InsightExplanation }
  | { status: 'failed'; fingerprint: string; reason: InsightFailureReason }
  | { status: 'session_limit'; fingerprint: string };

export type AssistantState = {
  run: number;
  sessionRequests: number;
  attempts: { fingerprint: string; count: number } | null;
  phase: AssistantPhase;
};

export type AssistantEvent =
  | { type: 'ask'; fingerprint: string }
  | { type: 'retry'; fingerprint: string }
  | { type: 'finished'; run: number; fingerprint: string; result: InsightResult }
  | { type: 'cancel' }
  | { type: 'clear' };

export const initialAssistantState: AssistantState = {
  run: 0,
  sessionRequests: 0,
  attempts: null,
  phase: { status: 'idle' },
};

export function assistantReducer(state: AssistantState, event: AssistantEvent): AssistantState {
  const { phase } = state;

  switch (event.type) {
    case 'ask': {
      // The same question over the same figures, already on its way or answered:
      // a re-render or a second tap sends nothing.
      if (
        (phase.status === 'loading' || phase.status === 'explained') &&
        phase.fingerprint === event.fingerprint
      ) {
        return state;
      }
      if (state.sessionRequests >= MAX_SESSION_REQUESTS) {
        return {
          ...state,
          run: state.run + 1,
          phase: { status: 'session_limit', fingerprint: event.fingerprint },
        };
      }
      const count =
        state.attempts?.fingerprint === event.fingerprint ? state.attempts.count + 1 : 1;
      if (count > MAX_ATTEMPTS_PER_QUESTION) return state;
      return {
        run: state.run + 1,
        sessionRequests: state.sessionRequests + 1,
        attempts: { fingerprint: event.fingerprint, count },
        phase: { status: 'loading', fingerprint: event.fingerprint },
      };
    }

    case 'retry': {
      if (phase.status !== 'failed' || phase.fingerprint !== event.fingerprint) return state;
      if (!canRetryInsight(state)) return state;
      return {
        run: state.run + 1,
        sessionRequests: state.sessionRequests + 1,
        attempts: { fingerprint: event.fingerprint, count: (state.attempts?.count ?? 0) + 1 },
        phase: { status: 'loading', fingerprint: event.fingerprint },
      };
    }

    case 'finished': {
      if (event.run !== state.run) return state;
      if (phase.status !== 'loading' || phase.fingerprint !== event.fingerprint) return state;
      const { result } = event;
      if (result.status === 'explained') {
        return {
          ...state,
          phase: {
            status: 'explained',
            fingerprint: event.fingerprint,
            explanation: result.explanation,
          },
        };
      }
      if (result.reason === 'cancelled') return { ...state, phase: { status: 'idle' } };
      return {
        ...state,
        phase: { status: 'failed', fingerprint: event.fingerprint, reason: result.reason },
      };
    }

    case 'cancel':
      return {
        ...state,
        run: state.run + 1,
        phase: phase.status === 'loading' ? { status: 'idle' } : phase,
      };

    case 'clear':
      return { ...state, run: state.run + 1, attempts: null, phase: { status: 'idle' } };
  }
}

/** Failures a second try might fix. A quota or a missing sign-in does not change by tapping. */
export function isRetryableInsightFailure(reason: InsightFailureReason): boolean {
  return (
    reason === 'timeout' ||
    reason === 'network' ||
    reason === 'unavailable' ||
    reason === 'invalid_response'
  );
}

export function canRetryInsight(state: AssistantState): boolean {
  return (
    state.phase.status === 'failed' &&
    isRetryableInsightFailure(state.phase.reason) &&
    (state.attempts?.count ?? 0) < MAX_ATTEMPTS_PER_QUESTION &&
    state.sessionRequests < MAX_SESSION_REQUESTS
  );
}
