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
| C1  | Accounts list                           | `accounts/index.tsx`             | Drawn  | 4     | ☑    |
| C2  | New Account                             | `accounts/new.tsx`               | Spec   | 4     | ☑    |
| C3  | Edit Account                            | `accounts/[id].tsx`              | Spec   | 4     | ☑    |
| D1  | People list                             | `people/index.tsx`               | Spec   | 4     | ☑    |
| D2  | Person detail                           | `people/[id].tsx`                | Drawn  | 4     | ☑    |
| D3  | New Person                              | `people/new.tsx`                 | Spec   | 4     | ☑    |
| E1  | Categories list                         | `categories/index.tsx`           | Spec   | 4     | ☑    |
| E2  | New / Edit Category                     | `categories/new.tsx`, `[id].tsx` | Spec   | 4     | ☑    |
| F1  | Budgets overview                        | `budgets/index.tsx`              | Drawn  | 5     | ☑    |
| F2  | Set a budget                            | `budgets/new.tsx`, `[id].tsx`    | Spec   | 5     | ☑    |
| G1  | Settings                                | `settings/index.tsx`             | Drawn  | 6     | ☑    |
| G3  | Cloud Sync                              | `cloud-sync/index.tsx`           | Spec   | 6     | ☑    |
| G4  | Cloud Sync setup                        | `cloud-sync/setup.tsx`           | Spec   | 6     | ☑    |
| G2  | App Lock (PIN)                          | `AppLockGate.native.tsx`         | Drawn  | 7     | ☑    |
| G5a | Sign In                                 | `cloud-sync/sign-in.tsx`         | Drawn  | 7     | ☑    |
| G5b | Create Account                          | `cloud-sync/sign-up.tsx`         | Drawn  | 7     | ☑    |
| H1  | Splash                                  | `app/_layout.tsx`                | Drawn  | 7     | ☑    |
| H2  | Onboarding (1 of 3)                     | `first-run/FirstRunGate.tsx`     | Drawn  | 7     | ☑    |
| H3  | Terms & Conditions                      | `first-run/FirstRunGate.tsx`     | Drawn  | 7     | ☑    |
| H4  | Forgot Password                         | `cloud-sync/forgot-password.tsx` | Drawn  | 7     | ☑    |
| H5  | Use Face ID                             | lock screen + Settings switch    | Drawn  | 7     | ☑    |
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

Budgets sits in the "Your Money" group, counted for the current month only — a budget never
describes more than one.

### C1 · Accounts

Segmented Active/Archived → total balance card → one card per account with a monochrome type icon,
the name, the type, and the current balance. A negative balance takes `negative` and nothing else:
no badge, no warning.

The type icon is monochrome rather than a category hue. An account is a container, not a kind of
spending, and a coloured chip would put it in competition with the balance beside it.

Balances are real, not opening balances. `getAccountBalance` already existed in
`features/transactions/account-balance.service.ts` but was not re-exported from `features/ui/data`;
this phase exports it. The total card appears **only when every listed account shares one currency**
— a single figure summing NPR and USD is arithmetic on unlike units, and this app does not print a
number it cannot stand behind.

### D2 · Person detail

Status card (state, direction, amount, and the one action that fits) → `Timeline` of history →
a collapsed "Edit details" disclosure → archive as a text action at the bottom.

The form is collapsed because someone opening a person's page almost always wants to know where the
debt stands, not to rename them.

### F1 · Budgets overview

Month stepper → overall ring card → category rows with a `ProgressBar` each.

The ring reads as how much of the month's promise is gone. Past 100% it fills entirely in
`negative` rather than wrapping: a ring that laps itself reads as being back near the start, which
is the opposite of the truth. The category bars do wrap, because `ProgressBar` rescales so the
overflow is visible past a marker — a bar can show how far over, a ring cannot.

Copy states the gap and the days left and stops there. No advice, no warning, no suggestion about
what to do with the remainder.

### F2 · Set a budget

`AmountInput` → what it covers (Everything, or one expense category) → which month. Income
categories are not offered: a budget is a ceiling on spending, and income has no ceiling to set.

The caption explains the one thing people get wrong — an overall budget already includes the
categories under it and is never added to them.

### G1 · Settings

Grouped `ListRow` lists: Preferences (currency, theme) · Privacy & Security (App Lock and Biometrics
as `Switch`, Auto-Lock and Change PIN as rows) · Cloud Sync · Export · Backup & Restore.

Choices apply as they are made; the old explicit "Save Settings" button is gone. A picker's choice
is complete the moment it is made, and a settings screen that can be left in an unsaved state is a
way to lose a change silently.

The three PIN operations — set, change, turn off — share one sheet and differ only in which fields
it asks for.

### G3 · Cloud Sync

A status card whose badge colour says only what the status supports: green means a completed cycle
and nothing weaker. Actions change with the state (signed out, signed in but unlinked, linked), and
the details list appears only once linked.

Signing out of a linked device is a data decision, so it opens a sheet with the two outcomes named
rather than a dialog with a yes and a no. Removing the local copy is confirmed again on its own.

### G4 · Cloud Sync setup

Inspect both sides, state what each side holds in full sentences, then offer one card per outcome.
The warning belongs on the card as well as in the confirmation, so the consequence is readable
before anything is tapped.

While linking runs there is no back control at all. Once the critical section starts there is no
safe cancel, so the screen must not appear to offer one.

### G2 · App Lock (PIN)

Mark, "Enter your PIN", four dots, a drawn keypad, and a Face ID action when biometrics are on.

The keypad is drawn rather than raising the system numeric keyboard. A system keyboard puts the
digits somewhere different on every device and covers half the screen doing it; a drawn one keeps
the targets where they were last time. A wrong PIN clears the field and fires an error haptic, so
the failure is felt as well as read.

The same mark on the canvas is what shows in the recents switcher, so a shoulder-glance or a
screenshot reveals no figures.

### H1 · Splash

The mark on the canvas and nothing that moves. Waits on migrations and fonts, which is what boot
already waited on, and nothing else. No spinner: a sub-second wait feels longer with one.

### H2 / H3 · Onboarding and Terms

Both live in `FirstRunGate`, above the navigator and inside `AppLockGate` — an existing user with a
lock unlocks before seeing either.

Terms comes first and needs its checkbox ticked, but it is a soft gate: three plain points about
where the data lives, who is responsible for the device, and that the app measures rather than
advises. Onboarding is three panels with line illustrations and a Skip that is always visible.

Their flags are device-local, set **only when the user finishes or skips**, never on display. An
interrupted first launch sees them again, which is the right failure: showing onboarding twice is a
far smaller harm than skipping it. An unreadable flag reads as "not done" for the same reason.

### H4 · Forgot Password

Built, reachable from Sign In, and honest: it says resetting from inside the app is not available
yet and points the user at their email. It shows no field, because a field that silently sends
nothing is worse than no field.

### H5 · Use Face ID

Not a screen of its own. There is nowhere in an optional-auth flow for a standalone biometric
prompt to live, so the affordance is the "Use Face ID" action on the lock screen and the Biometrics
switch in Settings, which appears directly under App Lock the moment it is turned on.

### B3 · Transfer

`From` and `To` selectors stacked with a circular swap button on the hairline between them.

Each account's current balance sits in tertiary beneath its name, read once per load through the
same `getAccountBalance` the accounts list uses. It is stated in the account's own currency rather
than the form's, since the two can differ and a figure under the wrong currency would be worse than
no figure. Every account selector in this form carries it, not only a transfer's: it is the same
control answering the same question, and suppressing it elsewhere would be the odd choice.

**Neutral colour throughout** — a transfer changes nothing overall and the design should say so.
Include the same-account error state.

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

| Question                    | Decided                                                     |
| --------------------------- | ----------------------------------------------------------- |
| When does Onboarding show?  | **Until dismissed** — repeats until finished or skipped ☑   |
| Does Terms gate entry?      | **Soft, dismissible** — shown once, with a way past it ☑    |
| What does Splash wait on?   | **Migration + fonts** — current boot behaviour, unchanged ☑ |
| Is Forgot Password wired?   | **Out of scope for now** — screen explains, does not send ☑ |
| Does auth become mandatory? | **Stays optional** — local-first, sign-in only offered ☑    |

Settled with the user on 2026-09-10. Build against these, and do not re-litigate them.

What each decision means in practice:

- **Onboarding until dismissed** needs a device-local flag set only when the user finishes or skips,
  never merely on display. An interrupted first launch must still get it. Store it beside the theme
  preference in `theme/preference.storage.*`-style device-local storage, never in SQLite — it must
  not sync, because it describes this device's user rather than their money.
- **Terms soft and dismissible** means a visible way past on the screen itself, and the same
  device-local flag treatment. It is not a blocking modal.
- **Splash unchanged** means H1 is a visual pass over the existing boot screen in `app/_layout.tsx`
  and nothing more. It must not start waiting on session restore — that would put a network-shaped
  delay in front of an app whose whole promise is working offline.
- **Forgot Password out of scope** means H4 is built and reachable, and says plainly that resetting
  is not available yet. It must not pretend to send anything.
- **Auth optional** means Splash and Onboarding lead into the app. No screen in this phase may
  block use, and none may imply an account is required.

The reasoning behind the last one, kept because it is the decision most likely to be questioned
later: the app's architecture is local-first, SQLite is the source of truth, and sync is additive.
An onboarding flow implying an account is required would contradict the product and break the
offline promise.

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
