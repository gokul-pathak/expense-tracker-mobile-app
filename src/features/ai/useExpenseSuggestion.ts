import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCloudAuth } from '@/features/cloud-auth/auth.provider';
import { useCloudSync } from '@/features/sync/sync.provider';

import type { AiSuggestionPreference } from './ai-preference';
import { loadAiSuggestionPreference, saveAiSuggestionPreference } from './ai-preference.storage';
import {
  suggestionAvailability,
  type SuggestionAvailability,
} from './expense-suggestion.presentation';
import { prepareExpenseSuggestion, requestExpenseSuggestion } from './expense-suggestion.service';
import {
  initialSuggestionState,
  suggestionReducer,
  type SuggestionEvent,
  type SuggestionState,
} from './expense-suggestion.state';
import type {
  AiExpenseSuggestionProvider,
  CategoryCandidate,
  ExpenseSuggestionContext,
  PreparedSuggestion,
} from './expense-suggestion.types';
import { supabaseSuggestionProvider } from './supabase-expense-suggestion.provider';

/**
 * Glue between a form and the suggestion service. Every decision is made in
 * the reducer, the service or the presentation module; this only schedules
 * them.
 *
 * What it guarantees a form:
 *
 * - **Nothing is sent without agreement.** Availability must be `available`:
 *   a configured project, a signed-in session, and a preference set to enabled.
 * - **At most one request per draft context.** The reducer dedupes by
 *   fingerprint, so renders, refocuses and reloaded category lists send nothing.
 * - **No late surprises.** Unmounting aborts the request, and `cancel` — which
 *   Save calls before saving — makes any answer still on its way stale.
 * - **No reach into the form.** It returns state; it is handed no setter for a
 *   category or a note, so it cannot change one.
 */

export type UseExpenseSuggestionOptions = {
  scope: string;
  context: ExpenseSuggestionContext;
  categories: readonly CategoryCandidate[];
  /** False until the form this serves is actually on screen. */
  active: boolean;
  provider?: AiExpenseSuggestionProvider;
};

export type ExpenseSuggestionController = {
  availability: SuggestionAvailability;
  state: SuggestionState;
  retry: () => void;
  cancel: () => void;
  choosePreference: (preference: 'enabled' | 'disabled') => void;
  refreshPreference: () => void;
  dismissCategory: () => void;
  dismissMerchant: () => void;
};

export function useExpenseSuggestion({
  scope,
  context,
  categories,
  active,
  provider = supabaseSuggestionProvider,
}: UseExpenseSuggestionOptions): ExpenseSuggestionController {
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [preference, setPreference] = useState<AiSuggestionPreference>(loadAiSuggestionPreference);
  const [state, setState] = useState<SuggestionState>(initialSuggestionState);
  const current = useRef(state);
  const pending = useRef<{ controller: AbortController | null }>({ controller: null });

  const apply = useCallback((event: SuggestionEvent) => {
    const next = suggestionReducer(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
    return next;
  }, []);

  const start = useCallback(
    (prepared: PreparedSuggestion, event: SuggestionEvent) => {
      const before = current.current;
      const after = apply(event);
      if (after === before || after.phase.status !== 'loading') return;

      pending.current.controller?.abort();
      const controller = new AbortController();
      pending.current.controller = controller;
      const { run } = after;
      void requestExpenseSuggestion(prepared, provider, { signal: controller.signal }).then(
        (result) => {
          if (pending.current.controller === controller) pending.current.controller = null;
          apply({ type: 'finished', run, fingerprint: prepared.fingerprint, result });
        },
      );
    },
    [apply, provider],
  );

  const availability = suggestionAvailability({
    configured: provider.isAvailable(),
    preference,
    authStatus: auth.status,
    syncStatus: sync.status,
  });

  const { merchantCandidate } = context;
  const outcome = useMemo(
    () => prepareExpenseSuggestion({ merchantCandidate }, categories, scope),
    [merchantCandidate, categories, scope],
  );

  useEffect(() => {
    if (!active || availability !== 'available' || outcome.kind !== 'ready') return;
    start(outcome.prepared, { type: 'request', fingerprint: outcome.prepared.fingerprint });
  }, [active, availability, outcome, start]);

  useEffect(() => {
    const box = pending.current;
    return () => box.controller?.abort();
  }, []);

  const retry = useCallback(() => {
    if (outcome.kind !== 'ready') return;
    start(outcome.prepared, { type: 'retry', fingerprint: outcome.prepared.fingerprint });
  }, [outcome, start]);

  const cancel = useCallback(() => {
    pending.current.controller?.abort();
    pending.current.controller = null;
    apply({ type: 'cancel' });
  }, [apply]);

  const choosePreference = useCallback((next: 'enabled' | 'disabled') => {
    saveAiSuggestionPreference(next);
    setPreference(next);
  }, []);

  const refreshPreference = useCallback(() => setPreference(loadAiSuggestionPreference()), []);
  const dismissCategory = useCallback(() => void apply({ type: 'dismiss_category' }), [apply]);
  const dismissMerchant = useCallback(() => void apply({ type: 'dismiss_merchant' }), [apply]);

  return {
    availability,
    state,
    retry,
    cancel,
    choosePreference,
    refreshPreference,
    dismissCategory,
    dismissMerchant,
  };
}
