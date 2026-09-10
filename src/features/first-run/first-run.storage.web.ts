import { ONBOARDING_KEY, TERMS_KEY, type FirstRunState } from './first-run';

/**
 * `localStorage`, for the same reason the theme preference uses it on web: the
 * native store is `expo-sqlite/kv-store`, and SQLite cannot open on a web page.
 *
 * Terms and onboarding are the only first-run screens that need no database, so
 * they render properly in a browser even though every screen with figures
 * cannot. That makes the web bundle usable for looking at them.
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
    return globalThis.localStorage?.getItem(key) === 'true';
  } catch {
    // An unreadable flag means "not done yet", which shows the screen again.
    return false;
  }
}

function write(key: string) {
  try {
    globalThis.localStorage?.setItem(key, 'true');
  } catch {
    // Private browsing can refuse storage. The choice then lives for the session.
  }
}
