/**
 * Theme-independent tokens.
 *
 * These values do not change between light and dark — only colour does. Keeping
 * them separate from the palettes means a component that needs spacing or type
 * never has to care which scheme is active.
 *
 * Reasoning for each value lives in
 * `.claude/skills/private-vault-design/references/tokens.md`.
 */

/**
 * 4pt base scale.
 *
 * `xl` (20) is the screen gutter and is used on every screen without exception —
 * consistent gutters are most of what makes an app feel considered. The steps
 * above `xxxl` exist for deliberate breathing room (the gap above a destructive
 * action, the space between a hero and the first section) and should be reached
 * for rather than stacking smaller values.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xl4: 40,
  xl5: 56,
  xl6: 72,
} as const;

/** The horizontal padding of every screen. Named so call sites read as intent. */
export const SCREEN_GUTTER = space.xl;

/**
 * Radii step up with an element's importance and size: a 20pt radius on a 44pt
 * button looks bulbous, and a 14pt radius on a full-width hero card looks stingy.
 */
export const radius = {
  pill: 999,
  control: 14,
  /** The pinned primary action at the foot of an entry form: taller, so slightly rounder. */
  button: 16,
  card: 20,
  heroCard: 24,
  sheet: 28,
} as const;

/**
 * Font families.
 *
 * Weight is carried by the family rather than `fontWeight`, because on Android a
 * `fontWeight` applied on top of an already-weighted custom family produces a
 * synthesised bold that does not match the real cut.
 *
 * Instrument Serif is used for exactly one thing — the hero money figure. Its
 * effect comes from scarcity; a second use would spend it.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  semibold: 'Inter_600SemiBold',
  serif: 'InstrumentSerif_400Regular',
} as const;

/**
 * The type scale.
 *
 * Each entry carries size, leading, family and tracking together because those
 * four are one decision — setting `fontSize` alone leaves the wrong leading and
 * tracking behind. Negative tracking on large text is not optional: Inter at
 * 44pt with default tracking reads loose and unconsidered.
 */
export const type = {
  /** Hero money only. */
  display: { fontSize: 44, lineHeight: 48, fontFamily: fonts.serif, letterSpacing: -0.66 },
  title: { fontSize: 28, lineHeight: 34, fontFamily: fonts.semibold, letterSpacing: -0.28 },
  heading: { fontSize: 20, lineHeight: 26, fontFamily: fonts.semibold, letterSpacing: -0.1 },
  subheading: { fontSize: 17, lineHeight: 22, fontFamily: fonts.semibold, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, letterSpacing: 0 },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fonts.semibold, letterSpacing: 0 },
  /** Amounts inside list rows. Always paired with tabular figures. */
  amount: { fontSize: 16, lineHeight: 20, fontFamily: fonts.semibold, letterSpacing: 0 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, letterSpacing: 0.72 },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, letterSpacing: 0 },
  /** Caption weight for a number that must read as a value: legend amounts, deltas, day totals. */
  captionStrong: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold, letterSpacing: 0 },
  /** Secondary line in rows and tiles: 13pt sits between caption and body. */
  small: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, letterSpacing: 0 },
  smallStrong: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold, letterSpacing: 0 },
  tab: { fontSize: 10, lineHeight: 12, fontFamily: fonts.semibold, letterSpacing: 0.2 },
} as const;

export type TypeVariant = keyof typeof type;

/**
 * Money is rendered as three parts at three sizes rather than one flat string.
 * The decimals are always 60% of the integer size and sit in the tertiary tone,
 * which is what stops an amount reading as an undifferentiated run of digits.
 */
export const moneySize = {
  hero: { integer: type.display, decimals: 26, gap: space.xs + 2 },
  /** The success screen's figure: larger than a stat, smaller than the hero, and not serif. */
  feature: {
    integer: { ...type.title, fontSize: 32, lineHeight: 36 },
    decimals: 19,
    gap: space.xs,
  },
  stat: { integer: { ...type.title, fontSize: 24, lineHeight: 28 }, decimals: 15, gap: space.xs },
  row: { integer: type.amount, decimals: 11, gap: space.xs },
  /**
   * The figure being typed into an entry form. Same 44pt as the hero, but Inter
   * rather than Instrument Serif: the serif is reserved for a settled balance,
   * and a serif digit changing under the caret reads as decorative rather than
   * as a number being entered.
   */
  entry: {
    integer: { ...type.title, fontSize: 44, lineHeight: 48, letterSpacing: -0.66 },
    decimals: 26,
    gap: space.sm,
  },
} as const;

export type MoneySize = keyof typeof moneySize;

/**
 * Motion is about weight, not personality.
 *
 * Springs are damped high so things settle rather than bounce — a bouncy spring
 * reads as playful, which is the wrong register for someone's savings.
 */
export const motion = {
  screenPush: { damping: 0.82, stiffness: 260, duration: 320 },
  sheetPresent: { damping: 0.85, stiffness: 240, duration: 380 },
  press: { scale: 0.97, duration: 120 },
  /**
   * First paint only. A balance that re-animates every time the screen regains
   * focus is irritating and makes the app feel slow; it should read as the
   * figure being totalled once, then settled.
   */
  numberReveal: { duration: 600 },
  chartDraw: { duration: 500, stagger: 40 },
  tabChange: { duration: 180 },
} as const;

/**
 * Fixed dimensions that recur across components. Named so a row height or a
 * touch target is one decision rather than a number retyped per screen.
 */
export const size = {
  /** Minimum touch target on either axis. */
  touchTarget: 44,
  /** Category chip: a rounded square holding the category icon. */
  categoryChip: 36,
  categoryChipRadius: 12,
  button: 48,
  /** The pinned action at the foot of an entry form, where it is the only target. */
  buttonLarge: 54,
  buttonSmall: 40,
  control: 52,
  chip: 32,
  listRow: 56,
  transactionRow: 68,
  navBar: 56,
  tabBar: 64,
  fab: 56,
  progressBar: 6,
  sheetHandle: { width: 38, height: 4 },
  /** The blinking caret beside an amount being entered. */
  caret: { width: 2, height: 40 },
} as const;

/** Backdrop behind a presented sheet. */
export const backdrop = { opacity: 0.55, blur: 12 } as const;

/** Lucide stroke width, fixed system-wide. */
export const ICON_STROKE = 1.5;

export const iconSize = { inline: 16, chip: 18, row: 20, tab: 24 } as const;
