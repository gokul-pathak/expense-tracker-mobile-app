import Storage from 'expo-sqlite/kv-store';

import { isThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from './preference';

/**
 * Theme is a device preference, like App Lock. It does not belong in the
 * synced `settings` row, where it would force every device onto one scheme.
 * The SQLite key-value store is synchronous, so the first frame already renders
 * in the chosen scheme instead of flashing the system one.
 */
export function loadThemePreference(): ThemePreference | null {
  try {
    const stored = Storage.getItemSync(THEME_PREFERENCE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    Storage.setItemSync(THEME_PREFERENCE_KEY, preference);
  } catch (error) {
    if (__DEV__) console.warn('Could not persist theme preference.', error);
  }
}
