# Components

22 primitives. Build in `src/components/ui/`, compose screens from them. Before writing a bespoke
view, check this list — the old UI drifted because each screen rolled its own row, chip, and selector.

**Contents:** [Foundation](#foundation) · [Layout](#layout) · [Rows and lists](#rows-and-lists) ·
[Controls](#controls) · [Overlays](#overlays) · [Navigation](#navigation) ·
[Data display](#data-display) · [States](#states)

---

## Foundation

### `Money`

The most-used component in the app. Splits an amount into currency code / integer / decimals and
applies tabular numerals, sign, and semantic colour. Full spec in `tokens.md` → Money rendering.

```tsx
<Money minorUnits={482650_00} currency="NPR" size="hero" />
<Money minorUnits={425000} currency="NPR" size="row" direction="expense" />
```

| Prop         | Values                       | Notes                                                              |
| ------------ | ---------------------------- | ------------------------------------------------------------------ |
| `minorUnits` | integer                      | Always integer minor units — never a float                         |
| `currency`   | `NPR` `USD` `INR`            | Drives grouping and the code shown                                 |
| `size`       | `hero` `stat` `row`          | See the size table in `tokens.md`                                  |
| `direction`  | `expense` `income` `neutral` | Sets sign and colour; omit for a plain total                       |
| `showCode`   | boolean                      | Default true; false inside a card that already states the currency |

Amounts are stored as integer minor units throughout the app. Never convert to float for display —
`parseMoneyToMinorUnits` and `formatMinorUnits` in `src/utils/money.ts` exist to avoid exactly that.

### `Text`

Wraps RN `Text` and takes a `variant` from the type scale rather than loose size/weight props. This
is what stops `fontSize: 15` appearing inline across the codebase.

```tsx
<Text variant="heading">Recent Transactions</Text>
<Text variant="caption" tone="tertiary">Sep 6, 2025</Text>
```

`tone`: `primary` (default) `secondary` `tertiary` `accent` `positive` `negative` `info` `warning`.

### `Icon`

Thin wrapper over `lucide-react-native` fixing stroke width at 1.5 and defaulting size by context.
Exists so the stroke weight can be changed in one place.

---

## Layout

### `Screen`

Safe-area wrapper, 20pt gutter, optional scroll. Replaces the current `Screen`, adding theme
awareness and scroll-linked nav bar behaviour.

### `Card`

`surface` ground, `radius.card`, hairline border, 16–24pt padding, theme-correct elevation.
**Reserve cards for genuine grouping.** A screen of six floating cards has no hierarchy — prefer one
card with hairline-separated rows.

### `BalanceCard`

The hero. `radius.heroCard`, 24pt padding, eyebrow label, `<Money size="hero">`, and a delta row
(`↑ 12.4% vs last month`) in `positive`/`negative`. In dark mode a barely-there champagne top-edge
glow (2% accent) lifts it off the canvas.

Only one per screen. It is the "largest number" rule made concrete.

### `StatTile`

Compact metric: eyebrow, `<Money size="stat">`, optional sparkline. Used in pairs (People summary)
and triples (month block). Inside a shared card divided by hairlines — not as separate cards.

---

## Rows and lists

### `TransactionRow`

68pt tall. Category chip (36pt) · primary label `bodyStrong` · secondary line `caption` tertiary
(account · payment mode) · trailing `<Money size="row">` right-aligned. Pressed: `surfaceRaised`,
scale .99.

The right-aligned tabular amounts are what make a list of these read as a ledger. Do not let the
label column push the amount out of alignment — truncate the label instead.

### `ListRow`

Icon · label · value or chevron. 56pt. The Settings and More primitive. Optional `trailing` slot
takes a value string, a `Switch`, or a chevron.

### `SectionHeader`

Eyebrow label left, optional text action right, 8pt below.

### `Timeline`

Vertical hairline with dots at each event, used for a person's lending history. Each entry: label,
date, amount with direction. Reads as a statement of record, which a stack of cards does not.

---

## Controls

### `Button`

| Variant       | Dark                            | Light                       |
| ------------- | ------------------------------- | --------------------------- |
| `primary`     | accent fill, ink text           | near-black fill, white text |
| `secondary`   | `surface` fill, hairline border | same                        |
| `text`        | no fill, accent text            | no fill, bronze text        |
| `destructive` | no fill, `negative` text        | same                        |

**Destructive is a text button, never a filled red block** — except inside an explicit confirmation
dialog, where a filled destructive button is correct because the user has already been warned.

### `Chip`

Pill, 32pt. Hairline border idle; `accentSoft` fill with accent text when selected. Filter chips,
category chips, quick-amount chips.

### `SegmentedControl`

2–3 options. `surfaceSunken` track, `surface` thumb, spring slide. Active/Archived, Expense/Income.

### `SelectorField`

Form input that opens a sheet: label above, value plus chevron in a 52pt control. The workhorse of
every entry form — category, account, person, date, payment mode.

Shows placeholder text in `tertiary` when unset, `primary` when set. Error state swaps the border to
`negative` and shows a message below.

### `AmountInput`

The entry hero. 44pt tabular figure, currency code fixed and muted to its left, caret as a 2pt
accent bar. **Underline only, no box** — a boxed input at this size looks like a form field, and
this is meant to look like the number is the screen.

### `Switch`

Themed toggle. Accent when on in dark; near-black when on in light.

---

## Overlays

### `BottomSheet`

`radius.sheet` top corners, grab handle, title row with a text "Done", scrollable body, blurred
dimmed backdrop (55% black, 12px blur). Springs in at `motion.sheetPresent`.

Every picker in the app is one of these. The current code uses raw RN `Modal` with hand-rolled
styles in four places — those collapse into this.

### `Dialog`

Centred confirmation for destructive actions. Title, body, cancel + confirm. This is the one place a
filled destructive button is right.

### `Toast`

Floating pill above the tab bar. "Transaction saved", "Backup created". Auto-dismisses.

---

## Navigation

### `NavBar`

56pt. Back chevron left (44×44 target), centred `subheading` title, optional right action. Title
crossfades in as the large screen title scrolls under it; hairline appears on scroll only.

Replaces the current plain text "Back" link in `FormScreen`.

### `LargeTitle`

28pt `title` in the content flow, collapsing into the NavBar on scroll.

### `TabBar`

Floating pill, 20pt above the bottom safe area, 16pt side inset, blurred `surface` at 80% with a
hairline. Four icons plus a centre FAB overlapping the top edge by 12pt. Active icon in `accent`
with a 3pt dot beneath. Labels 10pt.

Icons: `house` `arrow-left-right` `plus` `chart-pie` `menu`.

### `FAB`

56pt circle, accent fill, ink plus glyph, soft accent glow in dark. Centre of the tab bar. Opens the
Quick Add sheet rather than pushing a screen.

---

## Data display

### `DonutChart`

Category share. 12pt stroke, rounded caps, 2pt gaps between segments, total held in the centre.
Segments use category hues. Draws in at `motion.chartDraw` with a 40ms stagger.

### `AreaChart`

Income against expense over time. Two smoothed lines, gradient fill fading to 0%, draggable scrubber
with a value tooltip and vertical hairline. Positive and negative colours.

### `ProgressBar`

6pt, pill, `surfaceSunken` track. Budgets and category share.

Over-budget is the interesting case: render the overflow segment in `negative` past a hairline
marker at 100%, so the bar shows _how far_ past, not just "full". A capped bar hides the thing the
user most needs to see.

### `Sparkline`

Inline trend for stat tiles. No axes, no labels — shape only.

---

## States

Every list and detail screen needs all four. The old UI showed two lines of grey text for each,
which is why the app felt unfinished.

### `EmptyState`

Geometric line illustration (concentric arcs, an abstract ledger, a thin outlined card — **never a
piggy bank or coins**), `heading`, `body` secondary line, one primary action.

### `Skeleton`

Shapes matching the real layout, 1.4s shimmer. **Never a spinner** — a skeleton tells the user what
is arriving; a spinner tells them only to wait.

### `ErrorState`

Muted icon, one plain sentence, "Try Again" secondary button.

### `Banner`

Inline status strip for sync and warnings: icon, one line, optional action. Tinted
`info`/`warning`/`negative` at 10% with a hairline in the same hue. Not a toast — it stays.
