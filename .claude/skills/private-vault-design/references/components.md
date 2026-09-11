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
| `muted`      | boolean                      | Every part in `tertiary`, sign kept. Day totals, legend values     |

`muted` exists so a subordinate amount stays a `Money` rather than becoming a hand-built string. A
day total above a transaction list is still an amount, but rendering it in full direction colour
would outshout the rows it summarises.

At `hero` size the figure shrinks to fit its box rather than ending in an ellipsis
(`moneySize.hero.minimumScale`). No part of an amount carries a `lineHeight`, the currency code
included — see `tokens.md` → Money rendering for why.

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

Eyebrow label left, optional text action right, 8pt below. A `trailing` slot takes a value instead
of an action — a day total, a count. `tone` lifts the eyebrow from `tertiary` to `secondary` for a
date-group heading, which sits closer to the content than a page section does.

### `Timeline`

Vertical hairline with dots at each event, used for a person's lending history. Each entry: label,
date, amount with direction. Reads as a statement of record, which a stack of cards does not.

The dot takes the direction colour, so the shape of a debt — given, given, partly repaid — is
readable down the rail before any figure is.

Entries are described from the user's side: "You gave", "Ram paid". A neutral third-person label
would leave the reader working out which way the money went, which is the one thing this screen
exists to answer.

---

## Controls

### `Button`

| Variant       | Dark                            | Light                       |
| ------------- | ------------------------------- | --------------------------- |
| `primary`     | accent fill, ink text           | near-black fill, white text |
| `secondary`   | `surface` fill, hairline border | same                        |
| `text`        | no fill, accent text            | no fill, bronze text        |
| `destructive` | no fill, `negative` text        | same                        |

`large` gives 54pt and `radius.button`, for the pinned action at the foot of an entry form where it
is the only target on the row.

**Destructive is a text button, never a filled red block** — except inside an explicit confirmation
dialog, where a filled destructive button is correct because the user has already been warned.

### `Chip`

Pill, 32pt. Hairline border idle; `accentSoft` fill with accent text when selected. Filter chips,
category chips, quick-amount chips.

### `SegmentedControl`

2–3 options. `surfaceSunken` track, `surfaceRaised` thumb. Active/Archived, Expense/Income.

Not a filter chip row, and the distinction is load-bearing: chips add up and any number can be on,
segments replace each other and exactly one is always chosen. Reach for `Chip` when the user is
narrowing a list and for this when they are switching between two versions of it.

### `SearchField`

44pt field on `surfaceSunken` behind a hairline, leading magnifier, trailing clear button once
there is a value. Sunken rather than raised so it reads as a well cut into the page, which is what
separates it from the cards below it.

### `SelectorField`

Form input that opens a sheet: label above, value plus chevron in a 52pt control. The workhorse of
every entry form — category, account, person, date, payment mode.

Shows placeholder text in `tertiary` when unset, `primary` when set. Error state swaps the border to
`negative` and shows a message below.

### `TextField`

Label above, control below, error beneath — the counterpart to `SelectorField` for anything typed.
Same surface, hairline and radius, so a form mixing the two reads as one stack. `multiline` gives
88pt and top-aligned text for a note.

Replaces `FormField`, which is wired to react-hook-form and takes its error as a caller-supplied
string. Migrate each caller as you touch it.

### `AmountInput`

The figure at the top of every entry form: eyebrow, currency code, 44pt integer, 26pt decimals, and
a blinking accent caret, over a hairline.

44pt in **Inter**, not Instrument Serif — the serif is reserved for a settled balance, and a serif
digit changing under the caret reads as decorative rather than as a number being entered. The token
is `moneySize.entry`.

The real `TextInput` is invisible and stretched over the whole block, so the keyboard, selection and
paste behave natively while the visible figure is drawn to the design. Styling the input itself
cannot produce the three-part treatment. Input is sanitised as it is typed — digits, one dot, two
places — so what is on screen is always something the app can store.

### `Switch`

44×26 track with a 20pt knob. Accent when on; a raised track with a tertiary knob when off, so an
off switch reads as inert rather than as an error.

Drawn rather than wrapping RN's `Switch`, because the platform control cannot be tinted to this
palette on both systems and a settings list with one iOS-green switch in it is the fastest way to
break the design.

---

## Overlays

### `BottomSheet`

`radius.sheet` top corners, grab handle, title row with a text "Done", scrollable body, blurred
dimmed backdrop (55% black, 12px blur). Springs in at `motion.sheetPresent`.

Every picker in the app is one of these. The current code uses raw RN `Modal` with hand-rolled
styles in four places — those collapse into this.

### `PickerSheet`

A `BottomSheet` holding one list of options with a tick on the chosen one, an optional clearing row
("None", "Any account"), and an optional footer action ("Add Account"). Choosing closes the sheet:
a single choice is complete the moment it is made, so there is no Done to press.

Every picker in the app is one of these. The old code hand-rolled four near-identical modals, which
is how four different row heights and tick treatments got into one product.

### `Dialog`

Centred confirmation for destructive actions. Title, body, cancel + confirm. This is the one place a
filled destructive button is right.

Deliberately not a sheet: a sheet is where you choose among many, a dialog is where you stop and
answer one question.

### `Toast`

Floating pill above the tab bar. "Transaction saved", "Backup created". Auto-dismisses.

---

## Navigation

### `NavBar`

56pt. Back chevron left (44×44 target), centred `subheading` title, optional right action. Title
crossfades in as the large screen title scrolls under it; hairline appears on scroll only.

Replaces the current plain text "Back" link in `FormScreen`.

### `LargeTitle`

28pt `title` in the content flow, collapsing into the NavBar on scroll. Takes an optional round
40pt icon action on the right — `surfaceRaised` behind a hairline, with an optional 7pt accent
badge for "filters are active". The accessible label is required there, since the icon is the only
thing naming the control.

### `TabBar`

Floating pill, 20pt above the bottom safe area, 16pt side inset, blurred `surface` at 80% with a
hairline. Four icons plus a centre FAB overlapping the top edge by 12pt. Active icon in `accent`
with a 3pt dot beneath. Labels 10pt.

Icons: `house` `arrow-left-right` `plus` `chart-pie` `menu`.

The centre `plus` is not a route. Quick Add is a sheet over whatever screen you were on, so the tab
bar takes an `onFabPress` callback and the navigator registers four tabs, not five. The row leaves a
gap at its midpoint for the FAB to overlap rather than letting the button cover a tab.

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
with a vertical hairline and dots on each series. Positive and negative colours.

The scrubbed figures replace the axis labels beneath the plot rather than floating over it: a
tooltip inside a 130pt plot covers the very line the reader is reading. Touch anywhere in the plot
picks the nearest point — the lines themselves are a 2.5pt target and unusable with a finger.

Curves are Catmull-Rom through every point, so the line passes through the data rather than near it.
Path length cannot be measured in React Native, so the draw-in dash uses the polyline length plus a
margin.

### `ProgressBar`

6pt, pill, `surfaceSunken` track. Budgets and category share.

Over-budget is the interesting case: render the overflow segment in `negative` past a hairline
marker at 100%, so the bar shows _how far_ past, not just "full". A capped bar hides the thing the
user most needs to see.

A width says nothing out loud, so any bar whose meaning is the proportion passes
`accessibilityValueText` ("60% of budget spent"). That sets the platform's progress role and value
rather than a label, which is what lets it survive inside a row that is itself one accessible
element. `accessibilityLabel` is still there for a bar that stands alone and needs naming.

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
