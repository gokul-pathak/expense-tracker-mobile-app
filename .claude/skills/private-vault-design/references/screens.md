# Screens and build order

The roadmap. Work top to bottom — the order is chosen so each phase is testable on its own and later
phases compose primitives the earlier ones proved.

**Contents:** [Build order](#build-order) · [Status table](#status-table) ·
[Phase notes](#phase-notes) · [Auth product decisions](#auth-product-decisions) ·
[Sample data](#sample-data)

---

## Build order

| Phase | What                                                                                 | Why here                                                         |
| ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **0** | Theme module, fonts, `Money` `Text` `Icon` `Button` `Card`                           | Nothing can be built correctly before tokens exist in code       |
| **1** | Remaining primitives + **Home** end to end                                           | One screen proves the system before it is applied 35 times       |
| **2** | Transactions, Reports, Quick Add, More                                               | The primary tabs — the app's whole first impression              |
| **3** | Money entry: Add Expense → Income → Transfer → Lend/Borrow → Payment → Detail → Edit | Highest-traffic flows; all share `AmountInput` + `SelectorField` |
| **4** | Accounts, People, Categories                                                         | Management surface; mostly `ListRow` + `SegmentedControl`        |
| **5** | Budgets                                                                              | New feature — the M8A engine ships, the UI does not exist        |
| **6** | Settings, Cloud Sync, Cloud Sync setup                                               | Dense, low-traffic, benefits from every primitive being settled  |
| **7** | Auth and onboarding                                                                  | New product surface with real decisions — see below              |

**Phase 1 is the checkpoint.** Build Home completely — both themes, all four states, real data — and
look at it against the canvas before going wider. If the system is wrong, it is far cheaper to find
out on one screen.

## Status table

`Drawn` = an artboard exists in `design/private-vault-canvas.source.html`, dark and light.
`Spec` = specified in this skill and `docs/ui-redesign-brief.md`, composes from settled primitives.

| #   | Screen                                  | Route                            | Canvas | Phase | Done |
| --- | --------------------------------------- | -------------------------------- | ------ | ----- | ---- |
| A1  | Home / Dashboard                        | `(tabs)/index.tsx`               | Drawn  | 1     | ☑    |
| A2  | Transactions                            | `(tabs)/transactions.tsx`        | Drawn  | 2     | ☑    |
| A3  | Quick Add                               | `features/quick-add/QuickAdd`    | Drawn  | 2     | ☑    |
| A4  | Reports                                 | `(tabs)/reports.tsx`             | Drawn  | 2     | ☑    |
| A5  | More                                    | `(tabs)/more.tsx`                | Spec   | 2     | ☑    |
| B1  | Add Expense                             | `transaction/expense/new.tsx`    | Drawn  | 3     | ☑    |
| B2  | Add Income                              | `transaction/income/new.tsx`     | Spec   | 3     | ☑    |
| B3  | Transfer                                | `transaction/transfer/new.tsx`   | Spec   | 3     | ☑    |
| B4  | Lend / Borrow chooser                   | `transaction/people.tsx`         | Drawn  | 3     | ☑    |
| B5  | Record Money Given                      | `transaction/lend/new.tsx`       | Spec   | 3     | ☑    |
| B6  | Record Money Taken                      | `transaction/borrow/new.tsx`     | Spec   | 3     | ☑    |
| B7  | Record Payment                          | `people/[id]/payment.tsx`        | Spec   | 3     | ☑    |
| B8  | Transaction Detail                      | `transaction/[id].tsx`           | Spec   | 3     | ☑    |
| B9  | Edit Transaction                        | `transaction/[id]/edit.tsx`      | Spec   | 3     | ☑    |
| C1  | Accounts list                           | `accounts/index.tsx`             | Drawn  | 4     | ☐    |
| C2  | New Account                             | `accounts/new.tsx`               | Spec   | 4     | ☐    |
| C3  | Edit Account                            | `accounts/[id].tsx`              | Spec   | 4     | ☐    |
| D1  | People list                             | `people/index.tsx`               | Spec   | 4     | ☐    |
| D2  | Person detail                           | `people/[id].tsx`                | Drawn  | 4     | ☐    |
| D3  | New Person                              | `people/new.tsx`                 | Spec   | 4     | ☐    |
| E1  | Categories list                         | `categories/index.tsx`           | Spec   | 4     | ☐    |
| E2  | New / Edit Category                     | `categories/new.tsx`, `[id].tsx` | Spec   | 4     | ☐    |
| F1  | Budgets overview                        | _not built_                      | Drawn  | 5     | ☐    |
| F2  | Set a budget                            | _not built_                      | Spec   | 5     | ☐    |
| G1  | Settings                                | `settings/index.tsx`             | Drawn  | 6     | ☐    |
| G3  | Cloud Sync                              | `cloud-sync/index.tsx`           | Spec   | 6     | ☐    |
| G4  | Cloud Sync setup                        | `cloud-sync/setup.tsx`           | Spec   | 6     | ☐    |
| G2  | App Lock (PIN)                          | `AppLockGate.native.tsx`         | Drawn  | 7     | ☐    |
| G5a | Sign In                                 | `cloud-sync/sign-in.tsx`         | Drawn  | 7     | ☐    |
| G5b | Create Account                          | `cloud-sync/sign-up.tsx`         | Drawn  | 7     | ☐    |
| H1  | Splash                                  | _not built_                      | Drawn  | 7     | ☐    |
| H2  | Onboarding (1 of 3)                     | _not built_                      | Drawn  | 7     | ☐    |
| H3  | Terms & Conditions                      | _not built_                      | Drawn  | 7     | ☐    |
| H4  | Forgot Password                         | _not built_                      | Drawn  | 7     | ☐    |
| H5  | Use Face ID                             | _not built_                      | Drawn  | 7     | ☐    |
| —   | Feedback states (Success, Toast, Error) | shared                           | Drawn  | 1     | ☑    |

Tick the box when a screen is done in **both themes** with **all its states**.

## Phase notes

Only the screens with something non-obvious are noted. For the rest, the canvas plus
`components.md` is enough.

### A1 · Home

The screen that sells the product in three seconds. Greeting → `BalanceCard` → month block (Income /
Expense / Saved in one card divided by hairlines, **not** three cards) → Spending donut with a
top-five legend → Recent Transactions (one card of rows, "View All" action).

The balance is the only `hero` figure on the screen. The donut holds the month's total expense in
its centre.

### A3 · Quick Add

Currently a full page of four identical buttons. It becomes a **bottom sheet** over the previous
screen — 2×2 grid of tiles with icon, title, one-line description. Expense is visually primary; it
is by far the most-used action.

### A4 · Reports

Where the old design fails hardest — seven flat percentage-width bars become a real `AreaChart` and
`DonutChart`. Period pill → summary card → Income vs Expense area chart with scrubber → category
donut + ranked list → Insights as plain factual sentences with leading icons.

The canvas artboard drew only the ranked bars under "Spending by Category", with no donut — it ran
out of artboard height rather than dropping it. Built as spec: donut with the period total in its
centre, a hairline, then the ranked bars beneath it in the same card.

### A5 · More

Not drawn. Grouped `ListRow` list with real icons and right-hand values: Accounts ("4 active"),
People ("2 pending"), Budgets ("3 this month"), Categories ("19"), Settings, Cloud Sync (status,
colour-coded). Above it, a compact identity card — account email, or "Local only — not synced" with
a "Set up sync" action.

Budgets has no route until phase 5, so its row is not on the screen yet. Add it to the "Your Money"
group when `F1` lands.

### B3 · Transfer

`From` and `To` selectors stacked with a circular swap button on the hairline between them.

The canvas also puts each account's current balance in tertiary under its name. There is no
per-account balance query yet — `listActiveAccounts` returns the opening balance only — so that line
is not built. Add it when `C1` brings the balance query, since the accounts list needs the same
figure. **Neutral colour throughout** — a transfer changes
nothing overall and the design should say so. Include the same-account error state.

### B5 / B6 · Lend and Borrow

Each carries a quiet `Banner` correcting the most likely misunderstanding:

- Lend: "This is not an expense. It stays on your books as money owed to you."
- Borrow: "This is not income. It stays on your books as money you owe."

Transfer carries the same correction in its own terms: "A transfer moves money between your
accounts. Your total is unchanged."

For the same reason, **every movement form types its amount in the neutral colour**, not in
`negative` or `positive`. A red figure over a banner saying "this is not an expense" contradicts
itself. Only the expense and income forms colour the figure by direction.

### B7 · Record Payment

Header states the outstanding figure prominently. Amount pre-filled with the full outstanding sum,
with Full / Half / Custom chips. On a partial payment, a live line reads "Remaining after this
payment: NPR 10,000.00".

### B8 · Transaction Detail

A receipt. Hero block (category chip, label, `hero` amount in its semantic colour), then a detail
list with hairline separators. Variants needed: expense, transfer (From/To rows), lend (Person row
plus a "Record Payment" action).

### D2 · Person detail

Currently one page stacking a summary, history, edit form, and archive action. Split into three
zones separated by 32pt: **status card** (monogram, status chip, outstanding at `hero`, actions),
**history** as a `Timeline`, and **details** collapsed behind an "Edit details" disclosure so the
form does not compete with the money.

Avatars are monogram initials on a tinted circle — never a photo placeholder.

### E1 · Categories

A **grid**, not a list — 3 columns of tiles with hue chip, name, and "Default"/"Custom" caption.
This is where the category identity system becomes visible, so it is the showcase.

### F1 · Budgets

New. Month stepper (`← September 2025 →`), hero card with a circular progress arc for the overall
monthly budget, then per-category rows sorted **over-budget first**.

Show all four statuses: within budget, at budget, over budget (overflow segment past the 100%
marker, with "Over by NPR 4,200.00"), unused ("Nothing spent yet").

The M8A engine already computes all of this — `src/features/budgets/`. Read `docs/budgets-m8a.md`
before building; spending is never stored, it is summed on demand, and the UI must not cache it.

### G1 · Settings

The worst screen today — ten identical full-width buttons. Becomes a grouped list with section
eyebrows and right-hand values. **Nothing is a full-width filled button except a genuinely
destructive confirmation.** Groups: Preferences, Privacy & Security, Cloud Sync, Data, Backup &
Restore.

### G4 · Cloud Sync setup

The most consequential screen in the app — the user chooses which copy of their financial data
survives. Two large choice cards, each stating exactly what it will do in full sentences with record
counts on both sides, plus a reassurance banner: "A backup of this device is saved first, either
way." Keep it slightly solemn.

## Auth product decisions

Phase 7 adds surface that does not exist today. The app currently boots straight through
`AppLockGate` into the tabs; cloud auth is optional and lives in Settings. These are **product**
decisions, not styling ones — settle them with the user before building, and record the answers here.

| Question                    | Options                                                                         | Decided |
| --------------------------- | ------------------------------------------------------------------------------- | ------- |
| When does Onboarding show?  | First launch only · until dismissed · never again after Terms accepted          | ☐       |
| Does Terms gate entry?      | Hard gate before first use · soft, dismissible · shown only at sign-up          | ☐       |
| What does Splash wait on?   | DB migration only · migration + session restore · minimum display time          | ☐       |
| Is Forgot Password wired?   | Supabase reset email · deep link back into the app · out of scope for now       | ☐       |
| Does auth become mandatory? | Stays optional (local-first) · required for sync only · required to use the app | ☐       |

**Strong recommendation on the last one: auth stays optional.** The app's whole architecture is
local-first — SQLite is the source of truth and sync is additive. An onboarding flow that implies an
account is required would contradict the product and break the offline promise. Splash and
Onboarding should lead into the app, with sign-in offered rather than demanded.

Forgot Password needs real Supabase work (reset email template, redirect URL, deep link handling in
`expo-linking`). It is the one Phase 7 item that is not mostly UI — budget for it separately.

## Sample data

Use these values in mockups and manual testing so screens read like a real account rather than
lorem ipsum. They match the seeded categories and the canvas.

```
Accounts     Cash NPR 18,400.00 · NIC Asia Bank NPR 3,52,000.00
             eSewa Wallet NPR 12,250.00 · Credit Card −NPR 24,000.00
Total        NPR 4,82,650.00

Month        Income NPR 1,85,000.00 · Expense NPR 96,340.00 · Saved NPR 88,660.00

Categories   Food 32% · Bills 21% · Travel 18% · Groceries 14% · Shopping 9% · Other 6%

People       Anish Shrestha — owes you NPR 25,000.00 (pending)
             Sujan — you owe NPR 12,000.00
Totals       You will receive NPR 37,000.00 · You need to pay NPR 12,000.00

Budget       Overall NPR 96,340.00 of NPR 1,20,000.00 · Food over by NPR 4,200.00

Rows         Groceries −NPR 4,250.00 · Bhatbhateni · Card
             Salary +NPR 1,85,000.00 · NIC Asia Bank
             Fuel −NPR 3,000.00 · Cash
             Money Given −NPR 25,000.00 · Anish Shrestha
             Transfer NPR 50,000.00 · Cash → NIC Asia Bank (neutral, no sign)
```

Include at least one lakh-grouped figure (`1,24,500`) somewhere visible so the locale formatting
stays honest.
