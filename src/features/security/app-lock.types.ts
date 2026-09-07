export const AUTO_LOCK_OPTIONS = [0, 60_000, 5 * 60_000, 15 * 60_000] as const;
export type AutoLockTimeout = (typeof AUTO_LOCK_OPTIONS)[number];

export type LockConfig = {
  enabled: boolean;
  biometricEnabled: boolean;
  autoLockMs: AutoLockTimeout;
};
export type LockCredential = { securityVersion: 1; salt: string; verifier: string };
export type AuthenticationResult =
  | { status: 'success' }
  | { status: 'invalid_pin' }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'biometric_unavailable' }
  | { status: 'biometric_failed' }
  | { status: 'cancelled' };

export const DEFAULT_LOCK_CONFIG: LockConfig = {
  enabled: false,
  biometricEnabled: false,
  autoLockMs: 0,
};
