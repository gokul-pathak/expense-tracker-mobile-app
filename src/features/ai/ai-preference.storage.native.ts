import Storage from 'expo-sqlite/kv-store';

import {
  AI_INSIGHTS_DISCLOSURE_KEY,
  AI_SUGGESTION_PREFERENCE_KEY,
  parseAiSuggestionPreference,
  type AiSuggestionPreference,
} from './ai-preference';

/**
 * The key-value store beside the theme preference: synchronous, so a form
 * knows on its first render whether to ask, and separate from the finance
 * database, so no backup or sync path can pick it up.
 */
export function loadAiSuggestionPreference(): AiSuggestionPreference {
  try {
    return parseAiSuggestionPreference(Storage.getItemSync(AI_SUGGESTION_PREFERENCE_KEY));
  } catch {
    return 'unset';
  }
}

/** Returns false if the choice could not be kept; it then lasts for this session only. */
export function saveAiSuggestionPreference(preference: 'enabled' | 'disabled'): boolean {
  try {
    Storage.setItemSync(AI_SUGGESTION_PREFERENCE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function loadInsightsDisclosureSeen(): boolean {
  try {
    return Storage.getItemSync(AI_INSIGHTS_DISCLOSURE_KEY) === 'accepted';
  } catch {
    return false;
  }
}

export function saveInsightsDisclosureSeen(): boolean {
  try {
    Storage.setItemSync(AI_INSIGHTS_DISCLOSURE_KEY, 'accepted');
    return true;
  } catch {
    return false;
  }
}
