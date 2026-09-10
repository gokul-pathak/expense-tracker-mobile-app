import { describe, expect, it } from 'vitest';

import { formatMinorUnits, groupInteger, parseMoneyToMinorUnits } from '@/utils/money';

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

  it.each(['', 'abc', '12.999', '1.2.3', '--1', '90071992547409.92'])(
    'rejects invalid or unsafe amount %j',
    (input) => {
      expect(parseMoneyToMinorUnits(input)).toBeNull();
    },
  );

  it('formats exact minor units in the currency locale', () => {
    expect(formatMinorUnits(99999999999, 'npr')).toBe('NPR 99,99,99,999.99');
    expect(formatMinorUnits(99999999999, 'usd')).toBe('USD 999,999,999.99');
    expect(formatMinorUnits(-425000, 'NPR')).toBe('-NPR 4,250.00');
    expect(formatMinorUnits(12450000, 'INR')).toBe('INR 1,24,500.00');
  });

  it.each([
    ['0', 'lakh', '0'],
    ['999', 'lakh', '999'],
    ['1000', 'lakh', '1,000'],
    ['124500', 'lakh', '1,24,500'],
    ['48265000', 'lakh', '4,82,65,000'],
    ['124500', 'thousand', '124,500'],
    ['1000000', 'thousand', '1,000,000'],
  ] as const)('groups %s as %s -> %s', (digits, style, expected) => {
    expect(groupInteger(digits, style)).toBe(expected);
  });
});
