/**
 * The two palettes.
 *
 * Dark is primary — it is designed and reviewed first. Only `ThemeProvider`
 * should import from this file; a component reaching for `dark` or `light`
 * directly is the reliable way to end up correct in one scheme and broken in the
 * other. Components read the resolved palette from `useTheme()`.
 *
 * Reasoning for each value lives in
 * `.claude/skills/private-vault-design/references/tokens.md`.
 */

/**
 * Shadow, expressed for both platforms.
 *
 * React Native supports a single shadow layer, so the light-mode two-layer
 * design is approximated with the wider of the two. Android reads `elevation`
 * and ignores the rest.
 */
export type Elevation = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type Palette = {
  scheme: 'dark' | 'light';

  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;

  hairline: string;
  divider: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  accent: string;
  accentPressed: string;
  accentSoft: string;
  onAccent: string;

  /** The fill and label for a primary button. Deliberately different per scheme. */
  primaryFill: string;
  onPrimaryFill: string;

  positive: string;
  negative: string;
  info: string;
  warning: string;

  /**
   * The toast is a note laid on top of the page: raised surface in dark, ink in
   * light. Its action stays champagne in both, because it sits on ink either way.
   */
  toast: { surface: string; text: string; action: string; hairline: string };

  elevation: { card: Elevation; sheet: Elevation };
};

/**
 * Depth in dark mode comes from each layer being slightly lighter than the one
 * behind it, caught by a hairline — not from shadow. A shadow here has nothing
 * to fall on and reads as smudge, so `card` carries no shadow at all.
 *
 * `surfaceSunken` is darker than `canvas` so inset elements (progress tracks,
 * chart grounds) read as recessed rather than floating.
 */
export const dark: Palette = {
  scheme: 'dark',

  canvas: '#0A0C10',
  surface: '#12161E',
  surfaceRaised: '#1A1F2A',
  surfaceSunken: '#070910',

  hairline: 'rgba(255,255,255,0.07)',
  divider: 'rgba(255,255,255,0.05)',

  textPrimary: '#F2F4F7',
  textSecondary: '#98A1AE',
  textTertiary: '#5D6672',

  accent: '#D8C08A',
  accentPressed: '#C4A96F',
  accentSoft: 'rgba(216,192,138,0.12)',
  onAccent: '#0A0C10',

  primaryFill: '#D8C08A',
  onPrimaryFill: '#0A0C10',

  positive: '#5FD3A3',
  negative: '#F4726A',
  info: '#7AA2F7',
  warning: '#E8B84B',

  toast: {
    surface: 'rgba(26,31,42,0.96)',
    text: '#F2F4F7',
    action: '#D8C08A',
    hairline: 'rgba(255,255,255,0.10)',
  },

  elevation: {
    card: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    sheet: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.45,
      shadowRadius: 40,
      elevation: 24,
    },
  },
};

/**
 * The canvas is warm paper rather than the cool grey a light theme defaults to.
 * Cool grey reads as software chrome; warm off-white reads as paper and stock,
 * which is the point of a statement.
 *
 * The primary fill flips to near-black here. A bronze fill on white is muddy and
 * low-contrast — it looks like a mistake — while ink on warm paper carries the
 * same authority champagne does on ink. Bronze in this scheme is for text,
 * icons and selected states only, never a large fill.
 */
export const light: Palette = {
  scheme: 'light',

  canvas: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EFEDE8',

  hairline: 'rgba(16,20,28,0.08)',
  divider: 'rgba(16,20,28,0.06)',

  textPrimary: '#12151A',
  textSecondary: '#5C646F',
  textTertiary: '#8A929C',

  accent: '#8A6B32',
  accentPressed: '#6F5527',
  accentSoft: 'rgba(138,107,50,0.10)',
  onAccent: '#FFFFFF',

  primaryFill: '#12151A',
  onPrimaryFill: '#FFFFFF',

  positive: '#12855E',
  negative: '#C64236',
  info: '#3C63C8',
  warning: '#A8761A',

  toast: {
    surface: '#12151A',
    text: '#FFFFFF',
    action: '#D8C08A',
    hairline: 'rgba(255,255,255,0.10)',
  },

  elevation: {
    card: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
      elevation: 2,
    },
    sheet: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 32,
      elevation: 16,
    },
  },
};
