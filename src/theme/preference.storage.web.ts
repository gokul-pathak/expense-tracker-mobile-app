import { isThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from './preference';

export function loadThemePreference(): ThemePreference | null {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_PREFERENCE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    globalThis.localStorage?.setItem(THEME_PREFERENCE_KEY, preference);
  } catch {
    // Private browsing can refuse storage. The choice then lives for the session.
  }
}
