# Tokens

Values live in `src/theme/`. This file holds the reasoning — why each value is what it is, so you
can extend the system correctly instead of guessing.

**Contents:** [Colour — dark](#colour--dark) · [Colour — light](#colour--light) ·
[Semantic colours](#semantic-colours) · [Typography](#typography) · [Money](#money-rendering) ·
[Spacing](#spacing) · [Radius](#radius) · [Elevation](#elevation) · [Motion](#motion) ·
[Category identity](#category-identity) · [Icons](#icons)

---

## Colour — dark

Dark is the primary theme. It is designed first and reviewed first.

```
canvas            #0A0C10   app background, the deepest layer
surface           #12161E   cards, sheets, rows
surfaceRaised     #1A1F2A   modals, pressed states, inputs
surfaceSunken     #070910   inset wells, chart grounds, track fills

hairline          rgba(255,255,255,0.07)   1px borders — the only border weight
divider           rgba(255,255,255,0.05)   list separators

textPrimary       #F2F4F7
textSecondary     #98A1AE
textTertiary      #5D6672   timestamps, disabled, placeholder, decimals

accent            #D8C08A   champagne — CTAs, active tab, selected chips, focus ring
accentPressed     #C4A96F
accentSoft        rgba(216,192,138,0.12)
onAccent          #0A0C10   text and icons on an accent fill
```

**Why four surface levels rather than shadows.** In dark mode a drop shadow reads as dirt, not
depth — there is nothing for it to fall on. Elevation instead comes from each layer being slightly
lighter than the one behind it, with a hairline catching the edge. `surfaceSunken` is darker than
`canvas` so that inset elements (progress tracks, chart grounds) read as recessed.

**Why `#0A0C10` and not black.** Pure black on OLED makes surfaces above it float with a hard,
cheap edge, and it crushes the hairline. A very dark blue-grey keeps the layering legible.

## Colour — light

```
canvas            #F7F6F3   warm paper, NOT blue-grey
surface           #FFFFFF
surfaceRaised     #FFFFFF   distinguished by elevation, not tint
surfaceSunken     #EFEDE8

hairline          rgba(16,20,28,0.08)
divider           rgba(16,20,28,0.06)

textPrimary       #12151A
textSecondary     #5C646F
textTertiary      #8A929C

accent            #8A6B32   bronze — the champagne, deepened for contrast on white
accentSoft        rgba(138,107,50,0.10)
primaryFill       #12151A   primary buttons are near-black in light mode
onPrimaryFill     #FFFFFF
```

**Why warm paper.** The default light-mode instinct is a cool grey like `#F7F8FA` — which is what
the old theme used. Cool grey reads as "software chrome". Warm off-white reads as paper and stock,
which is the whole point of a statement.

**Why the button flips.** In dark, a champagne fill on ink is unmistakably expensive. In light, a
bronze fill on white is muddy and low-contrast — it looks like a mistake. Near-black fill on warm
paper carries the same authority. So: **bronze in light mode is for text, icons, and selected
states only, never a large fill.**

## Semantic colours

Identical roles across both themes, different values for contrast.

| Role       | Dark      | Light     | Means                                        |
| ---------- | --------- | --------- | -------------------------------------------- |
| `positive` | `#5FD3A3` | `#12855E` | Income, money you will receive, under budget |
| `negative` | `#F4726A` | `#C64236` | Expense, money you owe, over budget          |
| `info`     | `#7AA2F7` | `#3C63C8` | Sync state, informational badges             |
| `warning`  | `#E8B84B` | `#A8761A` | Attention required                           |

These are **reserved**. The moment green is used for a decorative accent, a green figure stops
meaning "money in" and the ledger becomes unreadable at a glance. Transfers are deliberately
neutral — money moving between your own accounts changes nothing overall, and the colour should say
so.

## Typography

Two families, and the split is deliberate:

- **Inter** — everything. A neutral grotesque with true tabular figures.
- **Instrument Serif** — the hero balance only, at 44pt.

**Why a serif for one number.** It is the single move that separates this from generic fintech. A
44pt serif figure reads as a printed statement rather than a dashboard readout. Confining it to one
element per screen keeps it a deliberate accent instead of a theme.

```
display     44 / 56   600   -1.5%   Instrument Serif   hero balance only
title       28 / 34   600   -1.0%   Inter              screen titles
heading     20 / 26   600   -0.5%   Inter              card and sheet titles
subheading  17 / 22   600    0      Inter              section headers
body        15 / 22   400    0      Inter              default text
bodyStrong  15 / 22   600    0      Inter              row primary labels
amount      16 / 20   600    0      Inter tabular      amounts in list rows
eyebrow     12 / 16   600   +6%     Inter UPPERCASE    section labels
caption     12 / 16   400    0      Inter              metadata, timestamps
tab         10 / 12   600   +2%     Inter              tab bar labels
captionStrong 12 / 16 600    0      Inter tabular      legend amounts, deltas, day totals
small       13 / 18   400    0      Inter              chip labels, legend labels, tile captions
smallStrong 13 / 18   600    0      Inter              chip labels selected, section actions
```

`captionStrong`, `small` and `smallStrong` were added when the canvas was reconciled with the
scale: the artboards use 13pt for legend labels, chip text and section actions, and a semibold 12pt
for small numbers. Without named tokens those would have become inline sizes.

Each token carries size, lineHeight, weight, and letterSpacing **together**, because those four are
one decision. A component that sets `fontSize` alone will have the wrong leading and tracking.

Negative tracking on large text is not optional — Inter at 44pt with default tracking looks loose
and amateurish. The larger the size, the tighter the track.

## Money rendering

The most important rule in the system. Three parts, three treatments:

```
  NPR      1,24,500        .00
  |        |               |
  caption  display/amount  caption
  12pt     44pt or 16pt    60% of the integer size
  tertiary primary         tertiary
  600      600 tabular     600 tabular
  baseline-aligned, 6pt gap between code and integer
```

| Size      | Integer               | Decimals      | Used in                                       |
| --------- | --------------------- | ------------- | --------------------------------------------- |
| `hero`    | 44pt Instrument Serif | 26pt tertiary | Balance card, budget hero, person outstanding |
| `stat`    | 24pt Inter            | 15pt tertiary | Stat tiles, summary cards                     |
| `row`     | 16pt Inter            | 11pt tertiary | Transaction rows, list items                  |
| `feature` | 32pt Inter            | 19pt tertiary | Success screen figure                         |
| `entry`   | 44pt Inter            | 26pt at 60%   | The figure being typed into an entry form     |

`entry` is the same 44pt as `hero` but in Inter, not Instrument Serif. The serif is reserved for a
settled balance; a serif digit changing under a caret reads as decorative rather than as a number
being entered.

`hero` carries `minimumScale: 0.6` and shrinks to fit its card rather than ending in an ellipsis. A
crore-scale balance outgrows the card on a narrow phone, and `NPR 1,24,5…` is unreadable where a
smaller figure is merely smaller. Android shrinks only as far as the width needs (React Native's
Android fit ignores the scale and floors at 4pt); iOS stops at 60%.

Rules `<Money>` encodes:

- **Tabular lining numerals.** Digits must align in columns down a list. A proportional figure in a
  ledger is the clearest possible tell of an amateur finance app.
- **True minus** `−` U+2212, never a hyphen. A hyphen is too short and sits at the wrong height.
- `+` appears only where direction is the point — transaction lists, history timelines.
- Negative totals take `negative` as a **type colour**. Never a red box, badge, or fill.
- Locale grouping including the South Asian lakh form: `1,24,500` not `124,500`.
- Transfers render with no sign and neutral colour.

## Spacing

```
4  8  12  16  20  24  32  40  56  72
```

- **Screen gutter is always 20.** Every screen, no exceptions. Consistent gutters are most of what
  makes an app feel considered.
- 12 between cards, 8 between rows inside a card, 32 between sections.
- The jump from 40 to 56 to 72 is for deliberate breathing room — the space above a destructive
  action, the gap between a hero and the first section. Reach for these rather than stacking 24s.

## Radius

```
pill      999   chips, segmented thumbs, progress tracks, FAB
control    14   buttons, inputs, selector fields
button     16   the pinned action at the foot of an entry form; account rows
card       20   standard cards
heroCard   24   balance card, budget hero
sheet      28   bottom sheets, top corners only
```

**`<Money>` ignores the leading in this table and takes the font's natural vertical box instead**,
for every part of an amount, the 12pt currency code included. On Android a `lineHeight` set on any
span of a `Text` sets the height of the whole line that span sits on — React Native renders it as a
`LineHeightSpan`, which Android applies per line rather than per span — and centres the font in that
height. The code's 16pt eyebrow leading squeezed the 44pt serif into a 16pt band across its middle,
which is why the code, the digits and the decimals were all sliced at the same height. Three earlier
fixes adjusted the digits' leading and left the code's in place. An amount is always one line, so
there is no leading to control anyway.

The consequence for anything else: never nest a span that carries a `lineHeight` inside larger
text, because the small span's leading becomes the whole line's height. And do not set an explicit
`lineHeight` on large text in a custom font, especially the serif. If you need `display` somewhere
new, let it size itself.

Radii step up with the element's importance and size. A 20pt radius on a 44pt-tall button looks
bulbous; a 14pt radius on a full-width hero card looks stingy. `button` exists because the pinned
form action is 54pt rather than 48pt, and a taller button carries a slightly rounder corner.

## Sizes

Fixed dimensions that recur, named so a row height or a touch target is one decision rather than a
number retyped per screen. Values live in `size` in `src/theme/tokens.ts`.

The ones worth knowing: `touchTarget` 44 (the floor on both axes, never go under it), `listRow` 56,
`transactionRow` 68, `control` 52, `button` 48, `buttonLarge` 54, `buttonSmall` 40, `navBar` 56,
`tabBar` 64, `fab` 56, `chip` 32, `categoryChip` 36, `progressBar` 6.

## Elevation

**Dark: no drop shadow.** Depth is surface lightening plus a hairline. This is not a stylistic
preference — a shadow in dark mode has nothing to fall on and reads as smudge.

**Light:** `0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)`. Two layers: a tight one
for the edge, a wide soft one for the lift. A single harsh shadow is the fastest way to make this
design look like a template.

**Sheets** get a stronger upward shadow in both themes, because a sheet genuinely floats over
content: `0 -8px 40px rgba(0,0,0,0.45)` dark, `0 -4px 32px rgba(16,24,40,0.12)` light.

## Motion

```
screenPush     320ms  spring(damping .82, stiffness 260)
sheetPresent   380ms  spring(damping .85); backdrop 55% black, 12px blur
press          scale .97, 120ms, light haptic
numberReveal   count-up 600ms ease-out — first paint only, never on re-render
chartDraw      500ms ease-out, grow from zero, 40ms stagger
tabChange      icon crossfade 180ms + accent dot slide
```

**Why "first paint only" on the number reveal.** A balance that re-animates every time the screen
regains focus is irritating and makes the app feel slow. It should feel like the figure is being
totalled once, then settled.

Motion here is about weight, not personality. Springs are damped high (.82–.85) so things settle
rather than bounce. A bouncy spring reads as playful, which is the wrong register for someone's
savings.

## Category identity

Every one of the 19 seeded categories gets an icon **and** a hue. The database already stores icon
keys (`food`, `groceries`, `fuel`…) that the old UI never rendered.

Render as a 36pt rounded square (radius 12), hue at 14% opacity as the fill, icon in the full hue.

**Expense**

| Category      | Icon              | Hue       |
| ------------- | ----------------- | --------- |
| Food          | `utensils`        | `#F4726A` |
| Groceries     | `shopping-basket` | `#E8934B` |
| Shopping      | `shopping-bag`    | `#D97BB5` |
| Travel        | `plane`           | `#7AA2F7` |
| Fuel          | `fuel`            | `#E8B84B` |
| Bills         | `receipt`         | `#6FB3C4` |
| Health        | `heart-pulse`     | `#F06A8A` |
| Entertainment | `clapperboard`    | `#A78BFA` |
| Education     | `graduation-cap`  | `#5B9BD5` |
| Family        | `users`           | `#5FD3A3` |
| Gifts         | `gift`            | `#EC7FA9` |
| Other         | `circle-dashed`   | `#98A1AE` |

**Income**

| Category          | Icon            | Hue       |
| ----------------- | --------------- | --------- |
| Salary            | `wallet`        | `#5FD3A3` |
| Business          | `briefcase`     | `#6FB3C4` |
| Freelance         | `laptop`        | `#7AA2F7` |
| Interest          | `percent`       | `#D8C08A` |
| Bonus             | `sparkle`       | `#E8B84B` |
| Investment Return | `trending-up`   | `#5FD3A3` |
| Other             | `circle-dashed` | `#98A1AE` |

**These hues are for category identity only.** They are not part of the palette and must not be used
for UI chrome. A category hue appearing on a button would break the one-accent rule.

Note the overlap with semantic colours is intentional and harmless — a green Family chip is clearly
a category badge, not a money figure, because of its shape and position.

**Account types get monochrome icons, not hues** — they are containers, not categories, and tinting
them would compete with the category system:

```
Cash          banknote
Bank          landmark
Wallet        wallet
Credit Card   credit-card
Other         circle-dashed
```

## Icons

`lucide-react-native`, 1.5px stroke. 20px in rows, 24px in tab bars, 16px inline with text.

The old UI used typographic glyphs (`⌂ ≡ ▥ ••• ▣ ◉ ◇ ⚙`) because no icon set was installed. Every
one of those is being deleted — if you see one, it is not a style choice, it is a leftover.

Tab bar mapping, confirmed against the canvas:

```
Home           house
Transactions   arrow-left-right
Add (FAB)      plus
Reports        chart-pie
More           menu
```

## Size

Fixed dimensions that recur across components, in `size`:

```
touchTarget      44   minimum on either axis
categoryChip     36   rounded square, radius 12 (categoryChipRadius)
button           48   buttonSmall 40
control          52   selector fields, inputs
chip             32
listRow          56   transactionRow 68
navBar           56   tabBar 64   fab 56
progressBar       6
sheetHandle      38 x 4
```

These are named so a row height is one decision rather than a number retyped per screen. When a
new component needs a fixed dimension, add it here rather than inlining it.

## Theme preference persistence

The System / Light / Dark choice is a **device** preference, like App Lock. It is stored in the
SQLite key-value store (`expo-sqlite/kv-store`, `localStorage` on web) rather than in the synced
`settings` row, because syncing it would force every device onto one scheme. The store is
synchronous, so the first frame renders in the chosen scheme with no flash.

## Toast colours

The toast is a note laid on top of the page, so it does not follow the surface rules of the page
beneath it. In dark it is `surfaceRaised` at 96% with a slightly stronger hairline; in light it is
**ink** with white text. The action stays champagne in both schemes because it always sits on a
dark ground. These live in `palette.toast`.
