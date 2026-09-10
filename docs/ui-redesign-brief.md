# UI Redesign Brief — "Private Vault"

A prompt pack for a design-AI tool (v0, Lovable, Figma Make, Stitch, Galileo, UX Pilot).
Everything below is derived from the actual codebase: real routes, real data models, real copy, real
currency. Paste **Part 1** first, then feed **Part 4** one screen at a time.

Target platform: **React Native / Expo (iOS + Android), portrait only.**
Artboard: **393 × 852 pt** (iPhone 16 Pro). Top safe area 59pt, bottom home indicator 34pt.

---

## Part 0 — What this app actually is

**Expense Tracker** is a local-first personal wealth tracker. Every figure is computed from an
on-device SQLite database; cloud sync (Supabase) is optional and additive. It is built for a South
Asian money culture: the default currency is **NPR**, and lending money to friends and family is a
first-class feature, not an afterthought.

It tracks seven kinds of money movement, and this is the product's real shape:

| Movement | User-facing name | What it means |
|---|---|---|
| `expense` | Expense | Money left an account |
| `income` | Income | Money entered an account |
| `transfer` | Transfer | Money moved between two of your own accounts |
| `lend` | **Money Given** | You lent money to a person |
| `borrow` | **Money Taken** | You borrowed money from a person |
| `repayment_received` | **Payment Received** | They paid you back |
| `repayment_paid` | **Repayment** | You paid them back |

Everything the user sees is real, private, and irreversible-feeling. There is no gamification, no
streaks, no confetti, no AI advice, no social feed. The tone is a **private banker's statement**:
factual, calm, precise, never chirpy and never alarmist. The app measures; it does not judge.

### The real data the screens display

- **Currency**: `NPR` default. `USD` and `INR` selectable. Money is stored as integer minor units and
  currently renders as `NPR 12,450.00`. **The redesign must change this rendering — see §2.4.**
- **Account types**: Cash, Bank, Wallet, Credit Card, Other.
- **Payment modes**: Cash, Debit Card, Credit Card, Bank Transfer, QR, Digital Wallet, Cheque, Other.
- **Expense categories** (seeded): Food, Groceries, Shopping, Travel, Fuel, Bills, Health,
  Entertainment, Education, Family, Gifts, Other.
- **Income categories** (seeded): Salary, Business, Freelance, Interest, Bonus, Investment Return, Other.
- **Report periods**: This Week, This Month, Last Month, 3 Months, 6 Months, This Year, Custom.
- **Budget statuses** (data layer ships, UI is next): unused, within budget, at budget, over budget.
- **Sync statuses**: unconfigured, local only, setup required, reconciliation required, linking,
  syncing, synced, pending changes, offline, auth required, account mismatch, attention required, error.
- **App lock**: 4–8 digit PIN + optional biometrics; auto-lock at Immediately / 1 min / 5 min / 15 min.

### What is wrong with the current UI (redesign these away)

1. Tab bar and list icons are **typographic glyphs** — `⌂ ≡ ▥ ••• ▣ ◉ ◇ ⚙`. No real icon set exists.
2. **No dark mode**, though the app declares `userInterfaceStyle: automatic`.
3. **No charts.** Category share and income-vs-expense trend are plain views with a percentage width.
   Seven flat bars stacked vertically is the entire Reports visualisation.
4. **Flat hierarchy.** Every surface is a white card on `#F7F8FA`. The total balance and a payment-mode
   row carry the same visual weight.
5. **Money reads like a string**, not like money: `NPR 12,450.00` at one size, one weight, one colour.
6. **Settings is a wall of ~10 identical full-width buttons** — export, backup, restore, PIN, biometrics,
   cloud, currency, all competing for the same attention.
7. **No motion, no haptics.** Sheets slide with the platform default; nothing else moves.
8. Category icon keys (`food`, `groceries`, `fuel`…) are stored in the database and **never rendered**.
9. Form screens have a plain text "Back" link instead of a navigation bar.
10. Empty and loading states are two lines of grey text with no illustration or shape.

---

## Part 1 — MASTER PROMPT (paste this first)

> You are designing a premium mobile app UI. Read this entire brief before producing anything, then
> hold it as the design system for every subsequent screen I ask for.
>
> **Product.** A private, local-first personal wealth tracker for iOS and Android, built in React
> Native. It tracks accounts, income, expenses, transfers, budgets, and money lent to or borrowed
> from people. Default currency NPR (Nepalese Rupee), also USD and INR. Data lives on the device;
> cloud sync is optional. The user is an adult managing real money — often a professional in
> Kathmandu, Delhi, or the diaspora — who lends to family, tracks cash alongside bank accounts, and
> wants their finances to feel *held*, not *gamified*.
>
> **The feeling to hit: a private bank's mobile app.** Discreet, weighty, quiet, expensive. Think
> Mercury, Copilot Money, Monzo Plus, Revolut Metal, Apple Card — not Mint, not a startup dashboard,
> not a crypto app. Premium here means **restraint**: deep ink surfaces, one metallic accent used
> sparingly, generous negative space, and typography doing the work decoration would do in a cheaper
> design. Colour appears only where it carries meaning (money in, money out, over budget).
>
> **Design in dark mode first**, then produce the light-mode counterpart of every screen. Both are
> first-class; the app follows the system theme.
>
> **Non-negotiables:**
> - Every monetary figure uses **tabular lining numerals** so digits align in columns down a list.
> - The currency code is **de-emphasised** relative to the amount. Never render `NPR 12,450.00` at a
>   single size and weight — follow the money-rendering rule below.
> - **One accent colour.** Do not introduce a second brand hue. Semantic green and red are reserved
>   exclusively for money direction and budget state.
> - Use a real line-icon set at 1.5px stroke (Lucide or Phosphor), 20px in rows, 24px in tab bars.
>   **No emoji, no typographic glyphs, no filled 3D icons.**
> - Minimum touch target 44×44pt. Body text never below 13pt. Text contrast at least 4.5:1.
> - Portrait only, 393 × 852pt, respecting a 59pt top safe area and a 34pt bottom home indicator.
> - No illustrations of coins, piggy banks, wallets, or currency symbols. No stock photography. No
>   gradients on text. No glassmorphism except the tab bar. No shadow harsher than the spec below.
>
> **Deliver for each screen:** the default state, plus its loading, empty, and error states where the
> screen has them, in both themes. Annotate spacing and type tokens on at least the first screen.

---

## Part 2 — Design system

### 2.1 Colour — dark (primary theme)

```
canvas            #0A0C10   app background, the deepest layer
surface           #12161E   cards, sheets, rows
surfaceRaised     #1A1F2A   modals, pressed states, inputs
surfaceSunken     #070910   inset wells, chart backgrounds, track fills

hairline          rgba(255,255,255,0.07)   1px borders — the ONLY border weight
divider           rgba(255,255,255,0.05)   list separators

textPrimary       #F2F4F7
textSecondary     #98A1AE
textTertiary      #5D6672   timestamps, disabled, placeholder

accent            #D8C08A   champagne — CTAs, active tab, selected chips, focus ring
accentPressed     #C4A96F
accentSoft        rgba(216,192,138,0.12)   accent-tinted fills
onAccent          #0A0C10   text and icons on an accent fill

positive          #5FD3A3   income, money you will receive, under budget
negative          #F4726A   expense, money you owe, over budget
info              #7AA2F7   sync, informational badges
warning           #E8B84B   attention-required states
```

### 2.2 Colour — light

```
canvas            #F7F6F3   warm paper, NOT blue-grey
surface           #FFFFFF
surfaceRaised     #FFFFFF   with the elevation shadow below
surfaceSunken     #EFEDE8

hairline          rgba(16,20,28,0.08)
divider           rgba(16,20,28,0.06)

textPrimary       #12151A
textSecondary     #5C646F
textTertiary      #8A929C

accent            #8A6B32   bronze — the champagne, deepened for contrast on white
accentSoft        rgba(138,107,50,0.10)
primaryFill       #12151A   PRIMARY BUTTONS IN LIGHT MODE ARE NEAR-BLACK, not bronze
onPrimaryFill     #FFFFFF

positive          #12855E
negative          #C64236
info              #3C63C8
warning           #A8761A
```

> The theme flip is deliberate: **dark mode's primary button is champagne on ink; light mode's is ink
> on paper.** Both read as expensive. A bronze-filled button on white does not.

### 2.3 Typography

Family: **Inter** (or Geist / Instrument Sans — a neutral grotesque with true tabular figures).
Enable `tabular-nums lining-nums` **globally on every monetary value**.

Optional editorial move, on the hero balance only: set the total balance in **Instrument Serif** or
**Fraunces** at 44pt. It gives the home screen a private-wealth-statement quality. Produce both
versions of the home screen so the choice can be made side by side.

```
display     44 / 48   weight 600   tracking -1.5%   hero balance only
title       28 / 34   weight 600   tracking -1.0%   screen titles
heading     20 / 26   weight 600   tracking -0.5%   card titles, sheet titles
subheading  17 / 22   weight 600                    section headers
body        15 / 22   weight 400                    default text
bodyStrong  15 / 22   weight 600                    row primary labels
amount      16 / 20   weight 600   tabular          amounts inside list rows
eyebrow     12 / 16   weight 600   tracking +6%     UPPERCASE section labels
caption     12 / 16   weight 400                    metadata, timestamps
tab         10 / 12   weight 600   tracking +2%     tab bar labels
```

### 2.4 Money rendering — the single most important rule

Amounts are **composite**, never one flat string. Three parts, three treatments:

```
  NPR      1,24,500        .00
  |        |               |
  caption  display/amount  caption
  12pt     44pt or 16pt    60% of the integer size
  tertiary primary         tertiary
  600      600 tabular     600 tabular
  baseline-aligned, 6pt gap between the code and the integer
```

- Hero balance: currency code above or leading at 12pt tertiary; integer 44pt; decimals 26pt tertiary.
- List rows: integer 16pt; decimals 11pt tertiary; sign prefix in the semantic colour.
- Use the true minus sign `−` (U+2212), never a hyphen. Positive amounts take `+` only in transaction
  lists, where direction is the point.
- Negative net figures (overspending, "you owe") use `negative` type colour; never wrap them in a red box.
- Thousands separators follow the locale — show the South Asian lakh grouping (`1,24,500`) in at
  least one mock so the handling is visible.

### 2.5 Spacing, radius, elevation, motion

```
space   4  8  12  16  20  24  32  40  56  72
gutter  20pt horizontal screen padding — every screen, no exceptions
gap     12pt between cards, 8pt between rows inside a card, 32pt between sections

radius  pill 999 · control 14 · card 20 · heroCard 24 · sheet 28 (top corners only)

elevation
  dark   NO drop shadow. Depth comes from surface lightening plus a 1px hairline.
  light  0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)
  sheet  0 -8px 40px rgba(0,0,0,0.45) dark; 0 -4px 32px rgba(16,24,40,0.12) light

motion
  screen push     320ms  spring(damping .82, stiffness 260)
  sheet present   380ms  spring(damping .85); backdrop 55% black with 12px blur
  press           scale .97, 120ms, light haptic
  number reveal   count-up 600ms ease-out, first paint only, never on re-render
  chart draw      500ms ease-out, bars and arcs grow from zero, staggered 40ms
  tab change      icon crossfade 180ms plus the accent dot sliding
```

### 2.6 Category identity system

Every category already stores an unused icon key. Give each one an icon **and** a hue. Render as a
36pt rounded square (radius 12) filled with the hue at 14% opacity, icon in the full hue.

```
Food               utensils          #F4726A
Groceries          shopping-basket   #E8934B
Shopping           shopping-bag      #D97BB5
Travel             plane             #7AA2F7
Fuel               fuel              #E8B84B
Bills              receipt           #6FB3C4
Health             heart-pulse       #F06A8A
Entertainment      clapperboard      #A78BFA
Education          graduation-cap    #5B9BD5
Family             users             #5FD3A3
Gifts              gift              #EC7FA9
Other              circle-dashed     #98A1AE

Salary             wallet            #5FD3A3
Business           briefcase         #6FB3C4
Freelance          laptop            #7AA2F7
Interest           percent           #D8C08A
Bonus              sparkle           #E8B84B
Investment Return  trending-up       #5FD3A3
Other (income)     circle-dashed     #98A1AE
```

Account types get monochrome icons, not hues: Cash `banknote`, Bank `landmark`, Wallet `wallet`,
Credit Card `credit-card`, Other `circle-dashed`.

---

## Part 3 — Component library

Design these once; every screen composes them.

1. **NavBar** — 56pt. Back chevron left (44×44 target), centred 17pt/600 title, optional right action.
   The title crossfades in as the large screen title scrolls under it. Hairline appears on scroll only.
2. **LargeTitle** — 28pt title in the content flow, collapsing into the NavBar on scroll.
3. **BalanceCard** — the hero. 24pt radius, `surface`, 24pt padding, an eyebrow label, the composite
   hero amount, and a delta row (`↑ 12.4% vs last month`) in `positive`/`negative`. In dark mode give
   it a barely-there champagne top-edge glow (2% accent) to lift it off the canvas.
4. **StatTile** — compact metric: eyebrow, amount, optional sparkline. Used in pairs and triples.
5. **TransactionRow** — 68pt tall. Category chip (36pt) · primary label 15/600 · secondary line 12pt
   tertiary (account · payment mode) · trailing composite amount, right-aligned, tabular.
   Pressed state: `surfaceRaised`, scale .99.
6. **SectionHeader** — eyebrow label left, optional text action right, 8pt below.
7. **Chip** — pill, 32pt, hairline border when idle, `accentSoft` fill with accent text when selected.
8. **SegmentedControl** — 2–3 options, `surfaceSunken` track, `surface` thumb, spring slide.
9. **ListRow** — icon · label · value or chevron. 56pt. The Settings and More primitive.
10. **SelectorField** — a form input that opens a sheet: label above, value plus chevron in a 52pt control.
11. **AmountInput** — the entry hero. 44pt tabular figure, currency code fixed and muted to its left,
    caret as a 2pt accent bar. Underline only, no box.
12. **BottomSheet** — 28pt top corners, grab handle, title row with a text "Done", scrollable body,
    blurred dimmed backdrop.
13. **TabBar** — floating pill, 20pt above the bottom safe area, 16pt side inset, blurred `surface` at
    80% with a hairline. Four icons plus a centre FAB overlapping the top edge by 12pt. Active icon in
    `accent` with a 3pt dot beneath. Labels 10pt.
14. **FAB (centre)** — 56pt circle, accent fill, ink plus glyph, soft accent glow in dark mode.
15. **EmptyState** — a geometric line illustration (concentric arcs, an abstract ledger, a thin
    outlined card — never a piggy bank), 20pt heading, 15pt secondary line, one primary action.
16. **LoadingState** — skeleton shapes matching the real layout, 1.4s shimmer. Never a spinner.
17. **ErrorState** — muted icon, one plain sentence, a "Try Again" secondary button.
18. **Banner** — inline status strip for sync and warnings: icon, one line, optional action. Tinted
    `info`/`warning`/`negative` at 10% with a hairline in the same hue.
19. **DonutChart** — category share. 12pt stroke, rounded caps, 2pt gaps, the total held in the centre.
20. **AreaChart** — income against expense over time. Two smoothed lines, gradient fill fading to 0%,
    a draggable scrubber with a value tooltip and a vertical hairline.
21. **ProgressBar** — budgets and category share. 6pt, pill, `surfaceSunken` track, hue fill.
    Over budget renders the overflow segment in `negative` past a hairline marker at 100%.
22. **PinPad** — 4–8 dots, custom 3×4 numeric keypad, 72pt keys, biometric glyph bottom-left, delete
    bottom-right. Shake plus haptic on failure.

---

## Part 4 — Screen-by-screen prompts

31 screens. Feed these one at a time after the master prompt. Sample values are realistic NPR figures;
use them verbatim so the mocks read like a real account.

### Group A — Primary tabs

#### A1. Home / Dashboard — `(tabs)/index.tsx`

The screen that has to sell the whole product in three seconds.

Contains, in order: a time-aware greeting ("Good evening") with the date; the **BalanceCard** showing
Total Balance `NPR 4,82,650.00`; a three-up month block — Income `NPR 1,85,000.00` in positive,
Expense `NPR 96,340.00` in negative, and Saved `NPR 88,660.00` on its own row below a hairline;
a **Spending** section with a donut of the month's category split (Food 32%, Bills 21%, Travel 18%,
Groceries 14%, Shopping 9%, Other 6%) and a legend of the top five with amounts; and **Recent
Transactions** — five rows with a "View All" text action.

Design notes: the balance is the only 44pt figure on the screen. The month block is a single card
divided by hairlines, not three separate cards. The donut carries the month's total expense in its
centre. Recent transactions are one card of rows with dividers, not five floating cards.

Also produce: **empty** (no accounts yet, one "Add Account" CTA), **loading** (skeleton), **error**.
And the alternate hero with the serif balance.

#### A2. Transactions — `(tabs)/transactions.tsx`

A searchable, filterable ledger. Large title "Transactions" with a filter icon (a badge dot when
filters are active). A search field. A row of type chips: All · Expense · Income. Rows grouped under
sticky date headers reading **Today**, **Yesterday**, then `Sep 6, 2025`. Each group header carries a
right-aligned day total in tertiary type.

Sample rows: Groceries `−NPR 4,250.00` · Bhatbhateni · Card; Salary `+NPR 1,85,000.00` · NIC Asia
Bank; Fuel `−NPR 3,000.00` · Cash; Money Given `−NPR 25,000.00` · Sujan; Transfer `NPR 50,000.00` ·
Cash → NIC Asia Bank (neutral colour, an arrow icon, no sign).

Also produce: the **filter bottom sheet** (Date: All Time / Today / This Week / This Month; Category
list with checkmarks; Account list; a "Clear Filters" action), the **empty** state (no transactions),
and the **no results** state (filters return nothing).

#### A3. Quick Add — `(tabs)/add.tsx`

Reached from the centre FAB. Currently four stacked identical buttons; redesign as a **bottom sheet**
that rises over the previous screen, not a full page. Four large tappable tiles in a 2×2 grid, each
with an icon, a title, and a one-line description:

- **Expense** `arrow-up-right`, negative tint — "Money you spent"
- **Income** `arrow-down-left`, positive tint — "Money you received"
- **Transfer** `arrow-left-right`, neutral — "Between your accounts"
- **Lend / Borrow** `handshake`, accent tint — "Money with people"

Expense is visually primary; it is the most-used action by a wide margin.

#### A4. Reports — `(tabs)/reports.tsx`

The screen where the current design fails hardest — seven flat bars must become real data
visualisation.

Large title "Reports" with a period selector directly beneath it, rendered as a pill showing the
active range ("This Month") with a chevron. Then a summary card: Income, Expense, Savings.
Then **Income vs Expense** as a smoothed dual-line area chart across the period, with a scrubber,
axis labels, and a legend. Then **Spending by Category** as a donut plus a ranked list with progress
bars and percentages. Then **Insights** — one card of plain factual sentences, each with a small
leading icon:

- "Food was your biggest expense category."
- "You spent 18% more than last month."
- "You saved NPR 88,660.00 during this period."

Also produce: the **period sheet** (This Week, This Month, Last Month, 3 Months, 6 Months, This Year,
Custom), the **custom range sheet** (two date fields plus an inline calendar and an Apply action),
and the **empty** state for a period with no activity.

#### A5. More — `(tabs)/more.tsx`

A settings hub, currently four glyph rows. Redesign as a grouped list with real icons and secondary
values on the right:

- **Accounts** `landmark` — "4 active"
- **People** `users` — "2 pending"
- **Budgets** `target` — "3 this month"  *(new — the data layer ships, the UI is next)*
- **Categories** `tag` — "19"
- **Settings** `settings`
- **Cloud Sync** `cloud` — status text in `positive` when synced, `warning` when attention is required

Above the list, a compact identity card: the account email when signed in, or "Local only — not
synced" with a "Set up sync" action when not.

### Group B — Money entry

#### B1. Add Expense — `transaction/expense/new.tsx`

The most-used screen in the app. It must feel instant and effortless.

Full-screen with a NavBar ("Add Expense", a close X on the left, "Save" on the right, disabled until
valid). The amount input dominates the top third: currency code `NPR` muted, then a 44pt tabular
figure with an accent caret. Below it, three **SelectorField** rows: Category (icon chip plus name),
Account (icon plus name plus type), Date (defaulting to Today). A "More Details" disclosure reveals
Note and Payment Mode. A large accent "Save Expense" button pinned above the keyboard.

Show it three ways: fresh and empty; filled in with `NPR 4,250.00` / Groceries / NIC Asia Bank /
Today; and with a validation error ("Enter an amount greater than 0").

Also produce the **category picker sheet** — a 4-column grid of category chips with icons and hues,
not a plain list — and the **account picker sheet** with an "Add Account" action at the bottom.

#### B2. Add Income — `transaction/income/new.tsx`

Identical structure to B1, with the category label reading **Source** and the amount rendered in
`positive`. Sample: `NPR 1,85,000.00` / Salary / NIC Asia Bank.

#### B3. Transfer — `transaction/transfer/new.tsx`

Amount, then **From** and **To** account selectors stacked with a circular swap button on the hairline
between them. Both accounts show their current balance in tertiary type beneath the name. Neutral
colour throughout — a transfer changes nothing overall, and the design should say so. Show a state
where From and To are the same account with the inline error.

#### B4. Lend / Borrow chooser — `transaction/people.tsx`

Two large cards, deliberately distinct:

- **Money I Gave** — "You gave money to someone temporarily." Action: "Record Money Given."
- **Money I Took** — "You borrowed money from someone." Action: "Record Money Taken."

Give each an illustrative directional icon and a subtle tint (negative for given, positive for taken).
This is a cultural centrepiece of the app; it should not read as a lesser sibling of Add Expense.

#### B5. Record Money Given — `transaction/lend/new.tsx`

Amount, a **Person** selector (with an "Add Person" action in the sheet), a **From Account** selector,
Date, and Note. A quiet informational banner: "This is not an expense. It stays on your books as money
owed to you." Sample: `NPR 25,000.00` to Sujan from Cash.

#### B6. Record Money Taken — `transaction/borrow/new.tsx`

Mirror of B5: Person, **To Account**, Date, Note. Banner: "This is not income. It stays on your books
as money you owe."

#### B7. Record Payment — `people/[id]/payment.tsx`

Reached from a person's page in two modes. Header states the outstanding figure prominently:
"Sujan owes you `NPR 25,000.00`" or "You owe Sujan `NPR 12,000.00`". Amount input pre-filled with the
full outstanding sum, with quick chips for Full Amount / Half / Custom. Then an account selector, a
date, and a note. Show the partial-payment state, where a live line reads "Remaining after this
payment: `NPR 10,000.00`".

#### B8. Transaction Detail — `transaction/[id].tsx`

A receipt, and it should look like one. A hero block: the category chip, the label, and the amount at
display size in its semantic colour. Beneath it, a detail list with hairline separators — Category,
Account, Date, Note, Payment Mode — each label tertiary left, value primary right. Two actions at the
bottom: "Edit" (secondary) and "Delete" (a text button in `negative`, never a filled red block).

Produce variants for an expense, a transfer (From and To rows), and a lend (Person row plus a
"Record Payment" action). Plus the **delete confirmation** alert: "Delete this transaction? This
action cannot be undone."

#### B9. Edit Transaction — `transaction/[id]/edit.tsx`

The B1 layout pre-filled, with the NavBar title "Edit Expense" and the primary action reading
"Save Changes", disabled until something actually changes.

### Group C — Accounts

#### C1. Accounts list — `accounts/index.tsx`

Large title "Accounts". A segmented control: Active · Archived. A total card at the top — "Total
Balance `NPR 4,82,650.00`" across the visible accounts. Then account cards, each with a type icon,
the name, the type as a caption, and the balance right-aligned. A "+ Add Account" action.

Sample: Cash `NPR 18,400.00`, NIC Asia Bank `NPR 3,52,000.00`, eSewa Wallet `NPR 12,250.00`,
Credit Card `−NPR 24,000.00` (a negative balance is normal here and should read calmly).

Also produce: the **archived** tab with dimmed cards and an "Archived" badge, and the **empty** state.

#### C2. New Account — `accounts/new.tsx`

NavBar "New Account". Fields: Account Name; Account Type as a row of five icon chips (Cash, Bank,
Wallet, Credit Card, Other); Opening Balance using the AmountInput treatment; Currency as three chips
(NPR, USD, INR); an optional icon picker. Primary "Save Account".

#### C3. Edit Account — `accounts/[id].tsx`

C2 pre-filled, plus a destructive-adjacent "Archive Account" text action in `warning` at the bottom,
separated by 32pt of space. Include the archive confirmation dialog: "Archive this account? It will be
hidden from active accounts but kept for historical records."

### Group D — People (lending ledger)

#### D1. People list — `people/index.tsx`

Large title "People". Segmented control: Active · Archived. Two summary tiles side by side —
**You Will Receive** `NPR 37,000.00` in positive, **You Need To Pay** `NPR 12,000.00` in negative.
Then person rows: an avatar (monogram initials on a tinted circle — never a photo placeholder), the
name, and a status line: "Owes you NPR 25,000.00", "You owe NPR 12,000.00", or a quiet "Settled".
Trailing chevron. A "+ Add Person" action.

Also produce the **empty** state and the **all-settled** state.

#### D2. Person detail — `people/[id].tsx`

Currently overloaded — a summary, a history, an edit form, and an archive action all on one page.
Split it visually into three clear zones separated by 32pt:

1. **Status card** — the person's name and monogram, a status chip (Pending / Partially Paid /
   Settled), the outstanding amount at display size, and one or two primary actions
   ("Record Payment" / "Repay").
2. **History** — a timeline, not a list of floating cards. A vertical hairline down the left with
   dots at each event: "You gave · Sep 2, 2025 · NPR 25,000.00", "Sujan paid · Sep 20, 2025 ·
   NPR 13,000.00". Directional icons and semantic colour on each amount.
3. **Details** — the name and note fields plus "Archive Person", collapsed behind an "Edit details"
   disclosure so it does not compete with the money.

Produce the settled variant and the archived variant (with the banner: "This person is archived. Their
financial history remains available, but new entries are disabled.").

#### D3. New Person — `people/new.tsx`

NavBar "New Person". Name and an optional Note. Deliberately minimal — two fields and a save button on
an otherwise empty screen reads as confident, not unfinished.

### Group E — Categories

#### E1. Categories list — `categories/index.tsx`

Large title "Categories". Segmented control: Expense · Income. A grid rather than a list — 3 columns
of category tiles, each with its hue chip, the name, and a caption reading "Default" or "Custom".
This is where the new category identity system becomes visible, so make it the showcase.
A "+ Add Category" action.

#### E2. New / Edit Category — `categories/new.tsx`, `categories/[id].tsx`

Name, a Type segmented control (Expense / Income), an **icon picker** (a scrollable grid of line
icons), and a **colour picker** (a row of the twelve hues as swatches). A live preview chip updates as
choices change. Editing a default category shows a note that it is a default and can be renamed but
not deleted.

### Group F — Budgets (new — the M8A data layer ships, no UI exists)

The design should include these; the engineering work follows.

#### F1. Budgets overview

Large title "Budgets" with a month stepper (`← September 2025 →`). A hero card for the **overall
monthly budget**: a large circular progress arc, `NPR 96,340.00` spent of `NPR 1,20,000.00`, the
remainder and the day count in secondary type. Then per-category budget rows: category chip, name,
spent-of-planned figures, a progress bar, and a percentage. Sort over-budget items to the top.

Show all four states in one screen: **within budget** (accent fill), **at budget** (a full bar with a
marker), **over budget** (an overflow segment in `negative` plus an "Over by NPR 4,200.00" caption),
and **unused** (a hairline track with "Nothing spent yet").

#### F2. Set a budget

A bottom sheet: a category selector (with an "Overall monthly budget" option at the top), a month
picker, and an AmountInput. Show last month's actual spending as a suggestion chip: "You spent
NPR 14,200.00 on Food last month."

### Group G — Settings and system

#### G1. Settings — `settings/index.tsx`

The worst screen in the app today — roughly ten identical full-width buttons stacked vertically.
Rebuild as a grouped iOS-style settings list with real icons, section eyebrows, and values on the
right. **Nothing here is a full-width filled button except a genuinely destructive confirmation.**

- **PREFERENCES** — Default Currency (value "NPR", opens a sheet); Theme (System / Light / Dark)
- **PRIVACY & SECURITY** — App Lock (a toggle); Auto-Lock (value "5 min", disabled until App Lock is
  on); Biometrics (a toggle); Change PIN (a row with a chevron)
- **CLOUD SYNC** — Cloud Sync (value: the status, colour-coded)
- **DATA** — Export Transactions (CSV); Export Transactions (JSON); Export All Data (JSON)
- **BACKUP & RESTORE** — Create Backup; Restore Backup (in `negative` text, with a caption:
  "Replaces all current local data. Backups are not merged.")

Also produce the **PIN entry sheet** (Current PIN / New PIN / Confirm PIN, with a numeric keypad) and
the **restore confirmation dialog** showing the backup's date, account count, transaction count,
people count, and currency.

#### G2. App Lock screen — `AppLockGate`

The first thing a user sees. It has to feel like a vault door, and it is the strongest opportunity in
the app for a premium first impression.

Centred: a small wordmark or monogram, "Enter your PIN", a row of 4–8 dots that fill as digits are
entered, and a custom 3×4 keypad with 72pt keys — digits in 24pt tabular, a biometric glyph
(`fingerprint` or `scan-face`) bottom-left, a delete glyph bottom-right. No visible text input.
Deep `canvas` background with a subtle radial accent glow behind the dots.

States: idle; three digits entered; **error** (dots shake, message "Incorrect PIN" in `negative`);
**rate limited** ("Try again in 28 seconds"); and the **biometric prompt** overlay.

#### G3. Cloud Sync — `cloud-sync/index.tsx`

A status-first screen. A hero status card with a large state icon, a title, a description, and the
pending-change count. The icon and tint change with state: synced `cloud-check` in positive; syncing
an animated `refresh-cw` in info; offline `cloud-off` in tertiary; attention required `alert-circle`
in warning; account mismatch in negative.

Below it, a details list — Cloud Account, Last Successful Sync ("2 minutes ago"), Changes Waiting To
Upload ("0"), Current Status, Last Problem. Then the actions: "Sync Now" primary, "Sign Out" secondary.

Produce at least four states: **synced**, **syncing** (with progress), **offline with 12 pending
changes**, and **signed out** (with Sign In and Create Account actions).

#### G4. Cloud Sync setup — `cloud-sync/setup.tsx`

The most consequential screen in the app: the user chooses which copy of their financial data
survives. It must be unmistakably clear and slightly solemn.

Two large choice cards, each stating exactly what it will do in full sentences and showing the record
counts on each side:

- **Keep this device's data** — "4 accounts, 312 transactions, 6 people on this device. Your cloud
  account's data will be replaced."
- **Use your cloud data** — "8 accounts, 1,204 transactions, 11 people in the cloud. This device's
  data will be replaced."

A reassurance banner beneath: "A backup of this device is saved first, either way." Then the
confirmation dialog, and a step-progress state ("Uploading your data… 3 of 5").

#### G5. Sign In / Create Account — `cloud-sync/sign-in.tsx`, `cloud-sync/sign-up.tsx`

Quiet, centred auth. A monogram, a title, an email and password field (with a show/hide toggle),
a primary button, and a footer link to the other mode. Create Account adds Confirm Password and a
one-line note: "Your data stays on this device too. Cloud sync is optional." Include an inline error
state and a loading state on the button.

#### G6. Global states

Design these once as a set, since every screen uses them:

- **Loading** — skeletons for a list screen, a detail screen, and a chart screen.
- **Empty** — the geometric line-illustration treatment, applied to three examples: no transactions,
  no accounts, no people.
- **Error** — a failed local-data read, with a "Try Again" action.
- **App boot** — a wordmark on `canvas` with a thin accent progress line ("Preparing your data").
- **Toast / snackbar** — a floating pill above the tab bar for "Transaction saved", "Backup created".

---

## Part 5 — Guardrails

Include these verbatim in the prompt; they prevent the failure modes design tools reach for.

**Do not:**
- Add a second accent colour, a gradient background, or a purple-to-blue mesh.
- Use green and red decoratively. They mean money in and money out, and nothing else.
- Draw a credit-card mockup with a fake number and a chip graphic on the home screen.
- Use emoji, 3D illustrations, glossy icons, or a piggy bank.
- Put a percentage badge on every metric; most numbers do not need a delta.
- Use pure black `#000000` or pure white `#FFFFFF` as a page background.
- Centre-align body text or long-form labels.
- Render an amount in a font without tabular figures.
- Add a chart because a space looks empty. Every chart answers a question the user actually has.
- Invent features: no crypto, no stocks, no bill scanning, no AI chat, no shared households, no
  spending score, no achievement badges.

**Do:**
- Leave space. If a screen looks sparse, it is probably right.
- Let the largest number on any screen be the most important one, and let there be only one.
- Use the hairline as the primary separator; reserve cards for genuine grouping.
- Keep destructive actions as text buttons in `negative`, never as filled red blocks — except inside
  an explicit confirmation dialog.
- Write copy in the app's existing register: plain, factual, complete sentences. "Expenses exceeded
  income by NPR 8,400.00", not "Uh oh! You overspent 😬".

---

## Part 6 — What to deliver back

1. A **style tile**: both palettes, the type scale specimen (with a money specimen at three sizes),
   the radius and elevation scale, and the full icon set.
2. **All 31 screens** in dark mode, at 393 × 852.
3. **Light-mode counterparts** for at least the twelve primary screens (A1–A5, B1, B4, C1, D1, D2,
   F1, G1, G2).
4. **State variants** as called out per screen — loading, empty, error, and the flow-specific ones.
5. A **flow board** showing the three critical paths side by side: add an expense, lend money and
   record its repayment, and set up cloud sync.
6. Exported **design tokens as JSON** (colour, type, spacing, radius, motion), so they can be dropped
   straight into `src/constants/theme.ts`.

---

## Appendix — Route to screen map

| Route | Screen | Section |
|---|---|---|
| `(tabs)/index` | Home / Dashboard | A1 |
| `(tabs)/transactions` | Transactions | A2 |
| `(tabs)/add` | Quick Add | A3 |
| `(tabs)/reports` | Reports | A4 |
| `(tabs)/more` | More | A5 |
| `transaction/expense/new` | Add Expense | B1 |
| `transaction/income/new` | Add Income | B2 |
| `transaction/transfer/new` | Transfer | B3 |
| `transaction/people` | Lend / Borrow chooser | B4 |
| `transaction/lend/new` | Record Money Given | B5 |
| `transaction/borrow/new` | Record Money Taken | B6 |
| `people/[id]/payment` | Record Payment | B7 |
| `transaction/[id]` | Transaction Detail | B8 |
| `transaction/[id]/edit` | Edit Transaction | B9 |
| `accounts/index` | Accounts list | C1 |
| `accounts/new` | New Account | C2 |
| `accounts/[id]` | Edit Account | C3 |
| `people/index` | People list | D1 |
| `people/[id]` | Person detail | D2 |
| `people/new` | New Person | D3 |
| `categories/index` | Categories list | E1 |
| `categories/new` | New Category | E2 |
| `categories/[id]` | Edit Category | E2 |
| *(not built)* | Budgets overview | F1 |
| *(not built)* | Set a budget | F2 |
| `settings/index` | Settings | G1 |
| `AppLockGate` | App Lock | G2 |
| `cloud-sync/index` | Cloud Sync | G3 |
| `cloud-sync/setup` | Cloud Sync setup | G4 |
| `cloud-sync/sign-in` | Sign In | G5 |
| `cloud-sync/sign-up` | Create Account | G5 |
