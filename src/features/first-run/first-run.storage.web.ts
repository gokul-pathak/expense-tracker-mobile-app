import type { FirstRunState } from './first-run';

/** The web build has no first-run flow, so nothing is ever shown or stored. */
export function loadFirstRunState(): FirstRunState {
  return { onboardingComplete: true, termsAccepted: true };
}

export function markOnboardingComplete() {}

export function markTermsAccepted() {}
