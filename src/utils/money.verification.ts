import { formatMinorUnits, parseMoneyToMinorUnits } from './money';

/** Development-only checks for the parser's supported decimal syntax. */
export function verifyMoneyParsing() {
  if (!__DEV__) throw new Error('Money verification is only available in development.');

  const valid: Record<string, number> = {
    '0': 0,
    '1': 100,
    '1.0': 100,
    '1.00': 100,
    '12.99': 1299,
    '1000': 100000,
    '1000.05': 100005,
  };
  for (const [input, expected] of Object.entries(valid)) {
    if (parseMoneyToMinorUnits(input) !== expected)
      throw new Error(`Money parser failed for ${input}.`);
  }
  for (const input of ['', 'abc', '1.2.3', '12.999', '--1']) {
    if (parseMoneyToMinorUnits(input) !== null) throw new Error(`Money parser accepted ${input}.`);
  }
  if (formatMinorUnits(1299, 'npr') !== 'NPR 12.99') throw new Error('Money formatter failed.');
  return true;
}
