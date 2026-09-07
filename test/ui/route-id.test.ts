import { describe, expect, it } from 'vitest';

import { parseRouteId } from '@/utils/route-id';

describe('route ID parsing', () => {
  it('accepts positive safe integer IDs only', () => {
    expect(parseRouteId('42')).toBe(42);
    expect(parseRouteId('0')).toBeNull();
    expect(parseRouteId('-1')).toBeNull();
    expect(parseRouteId('abc')).toBeNull();
    expect(parseRouteId(undefined)).toBeNull();
    expect(parseRouteId(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });
});
