const moneyPattern = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Convert a decimal money string to integer minor units without floating point arithmetic. */
export function parseMoneyToMinorUnits(value: string): number | null {
  const match = moneyPattern.exec(value.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  const minorText = `${sign}${whole}${fraction.padEnd(2, '0')}`;
  const minor = Number(minorText);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMinorUnits(minorUnits: number, currency: string): string {
  const sign = minorUnits < 0 ? '-' : '';
  const absolute = Math.abs(minorUnits);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${currency.toUpperCase()} ${whole}.${fraction}`;
}
