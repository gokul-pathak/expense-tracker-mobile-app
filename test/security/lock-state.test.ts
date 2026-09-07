import { describe, expect, it } from 'vitest';

import { isValidPin, retryAfterMs, shouldLockOnResume } from '@/features/security/lock-state';

describe('app lock state rules', () => {
  it('accepts only 4 to 8 numeric PIN digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12ab')).toBe(false);
  });
  it('locks deterministically for immediate and elapsed timeout policies', () => {
    expect(shouldLockOnResume(100, 100, 0)).toBe(true);
    expect(shouldLockOnResume(100, 60_099, 60_000)).toBe(false);
    expect(shouldLockOnResume(100, 60_100, 60_000)).toBe(true);
    expect(shouldLockOnResume(undefined, 160_000, 0)).toBe(false);
  });
  it('adds capped delay after repeated failures without permanent lockout', () => {
    expect(retryAfterMs(4)).toBe(0);
    expect(retryAfterMs(5)).toBe(5_000);
    expect(retryAfterMs(10)).toBe(30_000);
    expect(retryAfterMs(100)).toBe(30_000);
  });
});
