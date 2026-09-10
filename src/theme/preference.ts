/**
 * What the user chose, which is not the same as what is showing. `system`
 * defers to the OS, and is the default because a finance app that ignores the
 * device's appearance setting feels like it was ported from somewhere else.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'ui.theme-preference.v1';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
