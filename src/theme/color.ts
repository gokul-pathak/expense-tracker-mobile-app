/**
 * Tint a hex colour. Category hues and semantic colours are stored as opaque
 * hex, and the design uses them at low alpha for chip fills, banners and glows.
 * Doing the conversion in one place keeps `rgba(...)` strings out of components.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
