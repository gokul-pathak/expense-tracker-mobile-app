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

## Migrating a screen

The old (`src/constants/theme.ts`) and new (`src/theme/`) systems coexist. 39 files import the old
one across 429 call sites; migrating them at once produces an unreviewable diff.

**Migrate a screen when you touch it.** Procedure:

1. Swap `@/constants/theme` → `@/theme`; replace the top-level import with a `useTheme()` call.
2. Map the old tokens. They do not correspond one-to-one — this is a redesign, not a rename:

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

3. Replace hand-rolled views with primitives — most screens shed 30–50% of their code here. The
   four hand-rolled `Modal` implementations all become `BottomSheet`.
4. Replace glyph icons (`⌂ ≡ ▥ ••• ▣ ◉ ◇ ⚙ ›`) with Lucide.
5. Wrap every amount in `<Money>`.
6. Verify in **both themes** and all states.
7. Tick the screen in `screens.md`.

Run `npm run typecheck` after each screen. Do not add new usages of `src/constants/theme.ts` — when
the last screen migrates, delete it.

## Web parity

The app has `.web.ts` variants for storage, migrations, and app-lock, and most data screens render a
`NativeDataNotice` on web. The redesign does not change that split — but the shared components
(`Money`, `Text`, `Card`) must still render on web, since `NativeDataNotice` and the shell use them.

`BlurView`, haptics, and `fontVariant` degrade gracefully on web. Guard anything that does not.
