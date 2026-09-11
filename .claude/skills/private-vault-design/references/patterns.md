# React Native implementation patterns

How the design system is expressed in this codebase specifically. Read before Phase 0.

**Contents:** [Dependencies](#dependencies-to-add) · [Fonts](#fonts) · [Theming](#theming) ·
[Money](#money) · [Icons](#icons) · [Charts](#charts) · [Blur and haptics](#blur-and-haptics) ·
[Migration](#migrating-a-screen) · [Web parity](#web-parity)

---

## Dependencies to add

The app currently ships **no** font loading, icon set, or SVG library — the old UI used system fonts
and typographic glyphs. Phase 0 needs:

```bash
npx expo install expo-font @expo-google-fonts/inter @expo-google-fonts/instrument-serif \
  react-native-svg lucide-react-native expo-blur expo-haptics react-native-reanimated
```

- `react-native-svg` — required by `lucide-react-native` **and** by every chart. Install it first.
- `react-native-reanimated` — needed for the spring transitions, number count-up, and chart draw-in.
  Requires the Babel plugin; add `'react-native-reanimated/plugin'` **last** in `babel.config.js`.
- `expo-blur` — the floating tab bar. Blur is the one place glassmorphism is allowed.

Use `npx expo install` rather than `npm install` so versions match the Expo SDK.

## Fonts

Two families, loaded at boot:

```ts
import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
```

Load them in `src/app/_layout.tsx` alongside the existing DB migration gate — the app already blocks
on `initializeDatabase()`, so add fonts to that same wait rather than introducing a second one. A
screen that renders before fonts resolve flashes system-font text, which is especially ugly on the
44pt hero balance.

**Instrument Serif is used for exactly one thing**: the `hero` size in `<Money>`. If you find
yourself reaching for it elsewhere, that is the signal to stop — its power comes from scarcity.

Only two Inter weights ship (400, 600). The type scale uses no others. Resist adding 500 or 700;
every extra weight is bundle size for a distinction nobody will notice.

## Theming

```
src/theme/
├── tokens.ts        space, radius, type, motion — theme-independent
├── palettes.ts      dark, light
├── categories.ts    categoryIdentity: icon + hue per category
├── ThemeProvider.tsx
└── index.ts         barrel: useTheme, ThemeProvider, tokens
```

`useTheme()` returns the resolved palette plus the static tokens, so a component makes one call:

```tsx
const { palette, space, radius, type } = useTheme();
```

**Never import `dark` or `light` directly in a component.** That is how a screen ends up correct in
one theme and broken in the other. The only file that imports both is `ThemeProvider`.

Resolution order: an explicit user choice from settings, else the system scheme from RN's
`useColorScheme()`. Settings offers System / Light / Dark. The choice persists through
`src/theme/preference.storage.*` (SQLite key-value store on native, `localStorage` on web) —
**not** the synced `settings` row, because the scheme is a device preference and syncing it would
force every device onto one look. `ThemeProvider` reads it synchronously at mount.

**Styles.** `StyleSheet.create` cannot read the theme, so static styles hold only layout (flex,
spacing, radii) and colour is applied inline from the palette:

```tsx
<View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline }]} />
```

This keeps the structural styles memoised while letting colour follow the theme. A `useMemo`'d
factory is also fine for heavier screens.

## Money

`<Money>` renders the three parts as nested `Text` spans inside one parent `Text`, which is the
one layout RN baseline-aligns reliably on both platforms at mixed font sizes. The 6pt code gap is
whitespace inside the code span rather than a margin, for the same reason.

Tabular numerals in RN:

```tsx
<Text style={{ fontVariant: ['tabular-nums'] }}>1,24,500</Text>
```

Works on iOS and on Android (API 21+) provided the font carries the feature — Inter does. **Verify on
a real Android device**, not just the emulator; this is the kind of thing that silently falls back to
proportional figures and nobody notices until a list looks subtly wrong.

Amounts are integer minor units everywhere. `src/utils/money.ts` already has
`parseMoneyToMinorUnits` and `formatMinorUnits` — `<Money>` should build on those rather than doing
its own arithmetic. Never convert to float for display.

Lakh grouping is by currency, not device locale: `groupInteger` in `src/utils/money.ts` groups
NPR and INR in the lakh form and everything else in thousands, by hand rather than through `Intl`
so Hermes, web and Node tests agree. `splitMinorUnits` returns the three parts `<Money>` renders.

## Icons

```tsx
import { House, ArrowLeftRight, Plus } from 'lucide-react-native';
<House size={24} strokeWidth={1.5} color={palette.accent} />;
```

Wrap in the `Icon` component so stroke width and default sizes live in one place. Lucide icon names
are PascalCase in code but kebab-case in the canvas markup (`data-lucide="arrow-left-right"`) — the
canvas is the reference for _which_ icon, this is the reference for how to write it.

## Charts

There is no charting library in the project and none is needed. Both charts are simple enough to
hand-roll on `react-native-svg`, which avoids a heavy dependency and gives exact control over the
design:

- **DonutChart** — `Circle` elements with `strokeDasharray` / `strokeDashoffset`, rounded caps, 2pt
  gaps. Animate `strokeDashoffset` from full to target for the draw-in.
- **AreaChart** — a `Path` with a Catmull-Rom or cubic smoothing over the points, plus a
  `LinearGradient` fill fading to 0%. The scrubber is a `PanResponder` mapping x to the nearest data
  index.
- **Sparkline** — the same path logic with axes and interaction stripped out.

Reach for a library only if a genuinely new chart type appears. `victory-native` is the fallback if
so, but it will need heavy restyling to match.

## Blur and haptics

Tab bar:

```tsx
<BlurView intensity={80} tint={scheme === 'dark' ? 'dark' : 'light'} />
```

Blur is expensive on low-end Android. Fall back to a solid `surface` at 96% opacity when
`Platform.OS === 'android'` and the device is low-tier — a slightly flatter tab bar is better than a
janky one.

Haptics fire on press for primary actions, selection changes, and PIN failure:

```tsx
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
```

Not on scroll, not on every tap. Over-used haptics feel cheap, which is the opposite of the goal.

## The migration (finished)

`src/constants/theme.ts` is **deleted**, and so are the primitives it fed: `AppText`, `AppButton`,
`FormField`, `ScreenState` and `PlaceholderScreen`. Every screen reads from `src/theme/`. If you find
a raw hex code, font size or spacing number inline in a component, it is a regression rather than a
leftover — move it into `src/theme/` and record why in `tokens.md`.

The mapping below is kept only for reading old commits. Nothing in the working tree uses the left
column:

| Old                         | New                                        | Note                                                  |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `colors.background`         | `palette.canvas`                           |                                                       |
| `colors.surface`            | `palette.surface`                          |                                                       |
| `colors.surfaceMuted`       | `palette.surfaceSunken` or `surfaceRaised` | Depends on whether it reads recessed or raised        |
| `colors.text`               | `palette.textPrimary`                      |                                                       |
| `colors.textMuted`          | `palette.textSecondary` or `textTertiary`  | Metadata and placeholders go tertiary                 |
| `colors.border`             | `palette.hairline`                         |                                                       |
| `colors.primary`            | `palette.accent`                           | Check button variants — light mode uses `primaryFill` |
| `colors.success` / `danger` | `palette.positive` / `negative`            |                                                       |
| `spacing.lg` (16)           | `space.lg` (16)                            | Gutter moves to `space.xl` (20)                       |
| `radii.lg` (18)             | `radius.card` (20)                         |                                                       |
| `typography.*`              | `type.*`                                   | Now carries lineHeight, weight, tracking too          |

The rules that outlived it: compose from primitives rather than hand-rolling a view, icons come from
Lucide and never from a glyph, every amount goes through `<Money>`, and a screen is done only when it
works in both themes with all its states.

## Web parity

The web bundle boots and renders, but **it will never show a figure**. `expo-sqlite` runs SQLite as
WebAssembly and its synchronous API blocks the caller with `Atomics.wait`, which browsers forbid on
the main thread and which throws a `TypeError` there whatever headers are served. This app reads
SQLite synchronously everywhere, so the database cannot open on a page. `src/db/index.web.ts` keeps it
shut deliberately; without it the native module throws at import time and takes the whole bundle down
before React renders.

Do not try to fix this with cross-origin isolation headers. They are necessary but nowhere near
sufficient, and Expo's documented `metro.config` hook for adding them is inert anyway — Metro still
reads `server.enhanceMiddleware`, but the Expo CLI runs its own dev server and never calls it. Both
were measured before being ruled out.

What web is still good for: terms, onboarding, the tab shell, empty states, and any component you can
render in isolation. `.web.ts` variants exist for storage, migrations and app-lock. `BlurView`,
haptics and `fontVariant` degrade gracefully; guard anything that does not.

## Verifying a screen

**A browser is not evidence about a device.** This is the most expensive lesson in this project: the
hero balance rendered as a horizontal band with its top and bottom sliced off on Android while
`npm run typecheck`, `npm run lint`, 548 tests and a browser were all green. Three fixes were made
against browser evidence and each missed the cause, which was in React Native's Android text layout
— see **A `lineHeight` on any span sets the whole line's height** below.

So calibrate what each check can actually tell you:

| Check            | Catches                                   | Cannot catch                            |
| ---------------- | ----------------------------------------- | --------------------------------------- |
| typecheck / lint | wrong props, dead code                    | anything about how it looks             |
| tests            | domain logic, copy guards on screen files | any layout or type rendering            |
| browser          | structure, colour, theme flips, states    | text metrics, blur, haptics, safe areas |
| device           | all of it                                 | —                                       |

Text layout in a custom font is the sharpest divergence: web is forgiving about a box that is too
short for its glyphs, and Android clips them. Treat anything touching fonts, blur, haptics or
safe-area insets as unverified until it has run on hardware.

Two practical notes that cost real time here. Expo Go falls back to its **last cached bundle** when it
cannot reach Metro, so a device with no dev server running will keep replaying old code and every
screenshot will look like the fix failed — check the app's own "Cannot connect" notice before
believing a bug survived. And `CI=1` disables Metro's watch mode entirely, so edits appear to do
nothing.

## React Native layout traps

Two bugs in this codebase came from RN behaving unlike the web, and both were found by reading
computed values rather than by looking harder at the screen. **When a layout looks wrong, measure it**
— print the element widths and computed styles. Both of these took several wrong guesses by eye and
then fell out immediately once measured.

**A `lineHeight` on any span sets the whole line's height.** On Android, React Native turns a span's
`lineHeight` into a `CustomLineHeightSpan`, a `LineHeightSpan`, which Android applies to every line
the span touches rather than to its own characters, and it centres the font in that height. So a
12pt currency code carrying its 16pt eyebrow leading, nested inside a 44pt figure, squeezed the
whole amount into a 16pt band through its middle. The give-away was that the code and the decimals
were sliced at the same height as the digits: a font overflowing its own metrics would clip only the
large glyphs. Three fixes adjusted the digits' leading and missed the code's; reading
`CustomLineHeightSpan.kt` and `TextLayoutManager.kt` under `node_modules/react-native/ReactAndroid`
is what found it. `<Money>` now strips the leading from every part. Never nest a span with a
`lineHeight` inside larger text, and do not set an explicit `lineHeight` on large text in a custom
font.

**`flexShrink` governs the main axis, which in a column is height.** A control that stacks a value
over a detail line is a column, so `flexShrink` there does nothing about width, and right-aligning it
with `alignItems: 'flex-end'` sizes children to their own content and lets them spill sideways over
whatever sits beside them. Stretch the rows to the wrapper instead and let each push its own content
right with `justifyContent`. Related: every level from wrapper down to the text itself needs
`minWidth: 0`, because a text node defaults to `auto` — its own content width — and one such node
anywhere in the chain pushes the whole row wider than its parent.
