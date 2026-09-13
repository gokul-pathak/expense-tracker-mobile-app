import { useCallback, useEffect, useRef, useState } from 'react';

import { useCloudAuth } from '@/features/cloud-auth/auth.provider';
import { useCloudSync } from '@/features/sync/sync.provider';

import type { AiSuggestionPreference } from '../ai-preference';
import {
  loadAiSuggestionPreference,
  loadInsightsDisclosureSeen,
  saveAiSuggestionPreference,
  saveInsightsDisclosureSeen,
} from '../ai-preference.storage';

import { insightAvailability, type InsightAvailability } from './assistant.presentation';
import { requestFinancialInsight } from './assistant.service';
import {
  assistantReducer,
  initialAssistantState,
  type AssistantEvent,
  type AssistantState,
} from './assistant.state';
import type { AiFinancialInsightProvider, PreparedInsight } from './assistant.types';
import { supabaseInsightProvider } from './supabase-financial-insight.provider';

/**
 * Glue between Spending Insights and the explanation service.
 *
 * It asks only when told to — by a question the person submitted — and never
 * on mount, focus or render. It is handed a prepared request and gives back
 * state; it has no way to read or change a record. Leaving the screen aborts
 * any request in flight.
 */

export type FinancialInsightAssistant = {
  availability: InsightAvailability;
  /** True when the person chose Numbers Only during this visit. */
  declined: boolean;
  state: AssistantState;
  ask: (prepared: PreparedInsight) => void;
  retry: (prepared: PreparedInsight) => void;
  cancel: () => void;
  clear: () => void;
  /** The person accepted the disclosure for this question: remember it, then ask. */
  acceptDisclosureAndAsk: (prepared: PreparedInsight) => void;
  declineDisclosure: () => void;
  refreshPreference: () => void;
};

export function useFinancialInsightAssistant(
  provider: AiFinancialInsightProvider = supabaseInsightProvider,
): FinancialInsightAssistant {
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [preference, setPreference] = useState<AiSuggestionPreference>(loadAiSuggestionPreference);
  const [disclosureSeen, setDisclosureSeen] = useState(loadInsightsDisclosureSeen);
  const [declined, setDeclined] = useState(false);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const current = useRef(state);
  const pending = useRef<{ controller: AbortController | null }>({ controller: null });

  const availability = insightAvailability({
    configured: provider.isAvailable(),
    preference,
    disclosureSeen,
    authStatus: auth.status,
    syncStatus: sync.status,
  });

  const apply = useCallback((event: AssistantEvent) => {
    const next = assistantReducer(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
    return next;
  }, []);

  const send = useCallback(
    (prepared: PreparedInsight, event: AssistantEvent) => {
      const before = current.current;
      const after = apply(event);
      if (after === before || after.phase.status !== 'loading') return;

      pending.current.controller?.abort();
      const controller = new AbortController();
      pending.current.controller = controller;
      const { run } = after;
      void requestFinancialInsight(prepared, provider, { signal: controller.signal }).then(
        (result) => {
          if (pending.current.controller === controller) pending.current.controller = null;
          apply({ type: 'finished', run, fingerprint: prepared.fingerprint, result });
        },
      );
    },
    [apply, provider],
  );

  const ask = useCallback(
    (prepared: PreparedInsight) => {
      if (availability !== 'available' || declined) return;
      send(prepared, { type: 'ask', fingerprint: prepared.fingerprint });
    },
    [availability, declined, send],
  );

  const retry = useCallback(
    (prepared: PreparedInsight) => {
      if (availability !== 'available' || declined) return;
      send(prepared, { type: 'retry', fingerprint: prepared.fingerprint });
    },
    [availability, declined, send],
  );

  const abortPending = useCallback(() => {
    pending.current.controller?.abort();
    pending.current.controller = null;
  }, []);

  const cancel = useCallback(() => {
    abortPending();
    apply({ type: 'cancel' });
  }, [abortPending, apply]);

  const clear = useCallback(() => {
    abortPending();
    apply({ type: 'clear' });
  }, [abortPending, apply]);

  useEffect(() => {
    const box = pending.current;
    return () => box.controller?.abort();
  }, []);

  const acceptDisclosureAndAsk = useCallback(
    (prepared: PreparedInsight) => {
      saveAiSuggestionPreference('enabled');
      saveInsightsDisclosureSeen();
      setPreference('enabled');
      setDisclosureSeen(true);
      setDeclined(false);
      // Decided from the choice just made rather than from the next render, so
      // the question the person asked is sent from this tap and nothing else.
      const next = insightAvailability({
        configured: provider.isAvailable(),
        preference: 'enabled',
        disclosureSeen: true,
        authStatus: auth.status,
        syncStatus: sync.status,
      });
      if (next === 'available') send(prepared, { type: 'ask', fingerprint: prepared.fingerprint });
    },
    [auth.status, provider, send, sync.status],
  );

  const declineDisclosure = useCallback(() => setDeclined(true), []);

  const refreshPreference = useCallback(() => {
    setPreference(loadAiSuggestionPreference());
    setDisclosureSeen(loadInsightsDisclosureSeen());
  }, []);

  return {
    availability,
    declined,
    state,
    ask,
    retry,
    cancel,
    clear,
    acceptDisclosureAndAsk,
    declineDisclosure,
    refreshPreference,
  };
}
