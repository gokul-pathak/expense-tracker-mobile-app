import { describe, expect, it } from 'vitest';

import { formatMinorUnits, parseMoneyToMinorUnits } from '@/utils/money';

describe('money minor-unit conversion', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.0', 100],
    ['1.00', 100],
    ['12.99', 1299],
    ['1000.05', 100005],
    ['999999999.99', 99999999999],
  ])('parses %s without floating point arithmetic', (input, expected) => {
    expect(parseMoneyToMinorUnits(input)).toBe(expected);
  });

  it.each(['', 'abc', '12.999', '1.2.3', '--1', '90071992547409.92'])
    ('rejects invalid or unsafe amount %j', (input) => {
      expect(parseMoneyToMinorUnits(input)).toBeNull();
    });

  it('formats exact minor units', () => {
    expect(formatMinorUnits(99999999999, 'npr')).toBe('NPR 999,999,999.99');
  });
});
