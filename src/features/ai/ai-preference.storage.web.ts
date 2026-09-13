import {
  AI_INSIGHTS_DISCLOSURE_KEY,
  AI_SUGGESTION_PREFERENCE_KEY,
  parseAiSuggestionPreference,
  type AiSuggestionPreference,
} from './ai-preference';

export function loadAiSuggestionPreference(): AiSuggestionPreference {
  try {
    return parseAiSuggestionPreference(
      globalThis.localStorage?.getItem(AI_SUGGESTION_PREFERENCE_KEY),
    );
  } catch {
    return 'unset';
  }
}

export function saveAiSuggestionPreference(preference: 'enabled' | 'disabled'): boolean {
  try {
    globalThis.localStorage?.setItem(AI_SUGGESTION_PREFERENCE_KEY, preference);
    return true;
  } catch {
    // Private browsing can refuse storage. The choice then lives for the session.
    return false;
  }
}

export function loadInsightsDisclosureSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(AI_INSIGHTS_DISCLOSURE_KEY) === 'accepted';
  } catch {
    return false;
  }
}

export function saveInsightsDisclosureSeen(): boolean {
  try {
    globalThis.localStorage?.setItem(AI_INSIGHTS_DISCLOSURE_KEY, 'accepted');
    return true;
  } catch {
    return false;
  }
}
