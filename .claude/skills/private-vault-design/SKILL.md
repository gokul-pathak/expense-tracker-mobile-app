---
name: private-vault-design
description: The "Private Vault" design system for this React Native expense tracker — colour palettes, typography, money rendering, component specs, icon set, motion, and the screen-by-screen redesign roadmap. Use this skill whenever you touch anything visual in this repo: building or restyling a screen, adding or changing a component, picking any colour / font size / spacing / radius value, wiring dark mode, adding a feature that has UI, or answering why a screen looks the way it does. Also use it when the user mentions the design, the canvas, Private Vault, premium UI, theme tokens, fonts, or the redesign. Never choose a colour, size, or spacing value from memory or from the old theme file — every value is defined here, and guessing is how a design system dies.
---

# Private Vault design system

## Why this skill exists

This app is mid-migration from a plain utility UI to a deliberate design system called **Private
Vault**. Two things go wrong without a written system, and both are expensive to undo:

1. **Drift.** Someone needs a grey, picks `#888`, and ships it. Fifty screens later there are
   nineteen greys and no way to change them all at once.
2. **Re-derivation.** Each session re-invents how money should look, how a row should be spaced, what
   a card's radius is. The answers diverge, and the app stops feeling like one product.

So: values live in code, reasoning lives here, and neither gets guessed at.

## The product this is dressing

A local-first personal wealth tracker. Everything is computed from on-device SQLite; cloud sync is
optional. Default currency **NPR**, also USD and INR. Built for a South Asian money culture —
lending to friends and family is a first-class feature, not a footnote.

The register is a **private banker's statement**: factual, calm, precise. Never chirpy, never
alarmist. The app measures; it does not judge. There is no gamification, no streaks, no confetti, no
spending score, no AI advice. If you find yourself writing "Uh oh!" or "Great job!", stop.

**Premium here means restraint**, not decoration: deep ink surfaces, one metallic accent used
sparingly, generous negative space, and typography doing the work decoration would do in a cheaper
design. Reference points are Mercury, Copilot Money, and Apple Card — not Mint, not a crypto app.

## The rules that matter most

If you read nothing else, read these six. Everything in `references/` elaborates on them.

1. **Never hardcode a visual value.** No hex codes, no raw font sizes, no magic spacing numbers in
   a component. Import from `src/theme`. If a value you need isn't there, add it to the theme rather
   than inlining it — that keeps the next person from inventing a second version of it.
2. **Money is a component, never a string.** Use `<Money>`. An amount rendered as
   `NPR 12,450.00` at one size and weight is the single clearest tell of the old design.
3. **Every screen works in dark and light.** Dark is the primary theme. Read the palette from
   `useTheme()` — a component that imports one palette directly is broken in the other theme.
4. **One accent colour.** Champagne in dark, bronze/ink in light. Green and red mean money direction
   and budget state, and nothing else. Never introduce a second brand hue.
5. **Icons come from `lucide-react-native` at 1.5px stroke.** The old UI used typographic glyphs
   (`⌂ ≡ ▥ ••• ▣ ◉ ◇ ⚙`). Those are being deleted. No emoji, no glyphs, no filled 3D icons.
6. **Leave space.** If a screen looks sparse, it is probably right. The most common way to make this
   design cheap is to fill the gaps.

## Where things live

| What                       | Where                                     | Notes                                     |
| -------------------------- | ----------------------------------------- | ----------------------------------------- |
| Token values (code)        | `src/theme/`                              | **Source of truth.** Import from here.    |
| Token reasoning            | `references/tokens.md`                    | Why each value is what it is              |
| Component specs            | `references/components.md`                | The 22 primitives                         |
| Screen specs + roadmap     | `references/screens.md`                   | All 36 screens, status, build order       |
| RN implementation patterns | `references/patterns.md`                  | Fonts, theming, Money, charts, migration  |
| Visual ground truth        | `design/private-vault-canvas.source.html` | 41 rendered artboards                     |
| Original brief             | `docs/ui-redesign-brief.md`               | The prose brief the canvas was drawn from |

**When the canvas and this skill disagree, the canvas wins** for anything drawn — it is what the
design actually settled on. This skill wins for anything not drawn, since it is the reasoning that
would have produced it. Flag the disagreement rather than silently picking.

## Reading the canvas

`design/private-vault-canvas.source.html` is 41 artboards at 393×852, laid out in a two-column flow.
It is a large file — do not read it whole. Grep for what you need:

```bash
# Find a screen's artboard and read around it
grep -n "A1 · Home" design/private-vault-canvas.source.html

# See which screens were actually drawn
grep -oE '\b[A-G][0-9] · [A-Za-z][A-Za-z /&—-]{2,30}' design/private-vault-canvas.source.html | sort -u

# Check which icon a screen uses
grep -oE 'data-lucide="[a-z-]+"' design/private-vault-canvas.source.html | sort | uniq -c | sort -rn
```

To look at it rather than read it, serve `design/` over localhost and open the bundle in a browser —
`design/private-vault-canvas.bundle.html` is self-contained with fonts embedded.

## Tokens

Full values and reasoning in `references/tokens.md`. The shape in code:

```ts
import { useTheme } from '@/theme';

function Card() {
  const { palette, space, radius, type, elevation } = useTheme();
  // palette.surface, space.lg, radius.card, type.heading, elevation.card
}
```

The pieces:

- **`palette`** — theme-dependent colours. Switches with the active scheme. Never import `dark` or
  `light` directly in a component.
- **`space`** — `4 8 12 16 20 24 32 40 56 72`. Screen gutter is always `space.xl` (20).
- **`radius`** — `pill control(14) card(20) heroCard(24) sheet(28)`.
- **`type`** — each entry carries size, lineHeight, weight, and letterSpacing together, because
  those four are one decision. Never set a fontSize without the rest.
- **`elevation`** — in dark this is deliberately empty of shadow: depth comes from surface
  lightening plus a hairline. In light it is a soft two-layer shadow. Using a dark shadow in dark
  mode makes the surface look dirty rather than raised.
- **`motion`** — durations and spring configs. Reach for these rather than typing `300`.
- **`categoryIdentity`** — the icon and hue for each of the 19 seeded categories.

## Money rendering

The most important visual rule in the app. Amounts are **composite**, never one flat string:

```
  NPR      1,24,500        .00
  |        |               |
  caption  display/amount  caption
  12pt     44pt or 16pt    60% of the integer size
  tertiary primary         tertiary
```

Always use `<Money>` — it handles the split, tabular numerals, the sign, and the semantic colour:

```tsx
<Money minorUnits={482650_00} currency="NPR" size="hero" />
<Money minorUnits={-4250_00} currency="NPR" size="row" direction="expense" />
```

Details that `<Money>` encodes so you don't have to remember them:

- **Tabular lining numerals**, so digits align in columns down a list. A proportional figure in a
  ledger is the thing that makes a finance app feel amateur.
- **True minus sign** `−` (U+2212), not a hyphen.
- `+` appears only in transaction lists, where direction is the point.
- Negative totals take the `negative` colour — never a red box or a badge.
- Locale grouping, including the South Asian lakh form (`1,24,500`).

## Themes

Dark is primary and gets designed first. The palette flip is deliberate and worth understanding:

- **Dark:** primary button is champagne fill with ink text.
- **Light:** primary button is near-black fill with white text — _not_ bronze.

Both read as expensive. A bronze-filled button on white reads as a mistake. Bronze in light mode is
for text, icons, and selected states only.

Settings offers System / Light / Dark. The choice persists; `useTheme()` already resolves it, so a
component never needs to know which mechanism won.

## Components

22 primitives in `references/components.md`. Build them once in `src/components/ui/` and compose
screens from them. Before writing a bespoke view, check whether one of these covers it — the reason
the old UI drifted is that each screen rolled its own row, chip, and selector.

The ones that carry the most weight: `Money`, `TransactionRow`, `BalanceCard`, `SelectorField`,
`BottomSheet`, `TabBar`, `AmountInput`, `EmptyState`, `Skeleton`.

## Screens

`references/screens.md` holds all 36 screens: route, what the canvas drew, spec, and build order.
It is the roadmap a fresh session should work through.

Status in short: **11 screens drawn in the canvas** (dark + light), **5 new auth screens drawn** and
approved for build, **17 screens specified but not drawn** — those compose from primitives the drawn
screens already establish, so they need no new design round.

## Adding a new feature

When a feature brings new UI, the order that keeps the system intact:

1. **Check whether it's already specified.** Look in `references/screens.md` and the canvas first.
2. **Compose from existing primitives.** Most new surface is a rearrangement of `ListRow`,
   `SelectorField`, `Money`, and `BottomSheet`.
3. **If you need a genuinely new component**, add it to `src/components/ui/` _and_ document it in
   `references/components.md` in the same change. An undocumented component is the seed of the next
   drift.
4. **If you need a new token** — a colour, a size, a duration — add it to `src/theme/` and record the
   reasoning in `references/tokens.md`. Never inline it.
5. **New category?** Add its icon and hue to `categoryIdentity`. Every category needs both; a
   category with no identity falls back to grey and looks broken next to the others.

## Guardrails

These prevent the specific failure modes this design is prone to. Each one exists because it is the
thing a reasonable person would otherwise do.

**Don't:**

- Add a second accent colour, a gradient background, or a mesh.
- Use green or red decoratively. They carry meaning; spending them on decoration makes the meaning
  unreadable.
- Draw a fake credit card with a chip graphic and a made-up number.
- Use emoji, 3D illustrations, glossy icons, or a piggy bank.
- Put a percentage delta on every metric. Most numbers don't have a meaningful comparison.
- Use pure `#000000` or `#FFFFFF` as a page background.
- Centre-align body text or long labels.
- Render an amount in a font without tabular figures.
- Add a chart because a space looks empty. Every chart answers a question the user actually has.
- Invent features. No crypto, no stocks, no receipt scanning, no AI chat, no shared households, no
  achievement badges. The scope is what's in `references/screens.md`.

**Do:**

- Let the largest number on a screen be the most important one, and let there be only one.
- Use the hairline as the primary separator. Reserve cards for genuine grouping.
- Keep destructive actions as text buttons in `negative` — never a filled red block, except inside
  an explicit confirmation dialog.
- Write copy in complete, factual sentences: "Expenses exceeded income by NPR 8,400.00".
- Respect a 44×44pt minimum touch target and 4.5:1 text contrast.

## Migration state

The old system (`src/constants/theme.ts`) and the new one (`src/theme/`) coexist on purpose. 39
files still import the old one; migrating them in one commit would be a 429-call change with no way
to review it.

**Migrate a screen when you touch it**, not speculatively:

1. Switch its imports from `@/constants/theme` to `@/theme`.
2. Replace raw values with tokens.
3. Verify it in both themes.
4. Tick it off in `references/screens.md`.

When the last screen migrates, delete `src/constants/theme.ts`. Until then, **new code always uses
`src/theme/`** — never add a usage to the old file.
