import Storage from 'expo-sqlite/kv-store';

import { ONBOARDING_KEY, TERMS_KEY, type FirstRunState } from './first-run';

/**
 * The same synchronous key-value store the theme preference uses, so the first
 * frame already knows whether to show onboarding rather than flashing the app
 * and then covering it.
 */
export function loadFirstRunState(): FirstRunState {
  return {
    onboardingComplete: read(ONBOARDING_KEY),
    termsAccepted: read(TERMS_KEY),
  };
}

export function markOnboardingComplete() {
  write(ONBOARDING_KEY);
}

export function markTermsAccepted() {
  write(TERMS_KEY);
}

function read(key: string): boolean {
  try {
    return Storage.getItemSync(key) === 'true';
  } catch {
    // An unreadable flag means "not done yet", which shows the screen again.
    // Showing onboarding twice is a far smaller harm than skipping it.
    return false;
  }
}

function write(key: string) {
  try {
    Storage.setItemSync(key, 'true');
  } catch (error) {
    if (__DEV__) console.warn('Could not persist first-run state.', error);
  }
}
