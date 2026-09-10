/**
 * What this device's user has already been through.
 *
 * Device-local on purpose. These describe a person's progress through the app,
 * not their money, so they must never reach the synced `settings` row — a
 * second device would otherwise inherit a "seen" flag its owner never earned.
 */
export const ONBOARDING_KEY = 'first-run.onboarding-complete.v1';
export const TERMS_KEY = 'first-run.terms-accepted.v1';

export type FirstRunState = {
  /** Set only when onboarding is finished or skipped, never merely displayed. */
  onboardingComplete: boolean;
  termsAccepted: boolean;
};
