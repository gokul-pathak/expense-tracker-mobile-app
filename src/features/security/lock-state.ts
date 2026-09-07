import type { AutoLockTimeout } from './app-lock.types';

export function shouldLockOnResume(
  backgroundAt: number | undefined,
  now: number,
  timeoutMs: AutoLockTimeout,
) {
  return backgroundAt !== undefined && now - backgroundAt >= timeoutMs;
}

export function retryAfterMs(failedAttempts: number) {
  if (failedAttempts < 5) return 0;
  return Math.min(30_000, 5_000 * (failedAttempts - 4));
}

export function isValidPin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}
