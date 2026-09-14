# Release checklist

Everything below must be green before a build carrying Cloud Sync goes to real users. Items marked
**blocker** are not negotiable: they are the failure modes that lose or expose someone's financial
records.

## Build and code health

- [ ] `npm ci` succeeds from a clean checkout
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes, with no skipped sync or financial tests
- [ ] `npx expo-doctor` reports no new issues
- [ ] `npx expo export --platform web` still bundles

## Local-first guarantees

- [ ] A fresh install with no account and no network can create accounts, record every transaction
      type, and see correct balances, dashboard and reports
- [ ] A build with no Supabase configuration starts, works, and says Cloud Sync is unavailable
- [ ] Backup, restore and export work in Local Only, cloud-linked and offline states
- [ ] App Lock and biometrics work, and no cloud action can weaken or bypass them

## Cloud configuration

- [ ] `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` point at the intended
      environment for this build profile
- [ ] Development and preview builds do **not** point at the production project
- [ ] **blocker** no service-role key, database password or admin token anywhere in the client, the
      app config, or the build environment
- [ ] Supabase migrations in `supabase/migrations` recreate the schema from scratch
      (`npx supabase db reset`), with no dashboard-only changes

## Security

- [ ] **blocker** `supabase/tests/rls.sql` and `supabase/tests/rls-matrix.sql` pass against the
      target schema
- [ ] **blocker** `supabase/tests/integrity.sql`, `supabase/tests/budgets.sql` and
      `supabase/tests/recurring.sql` pass
- [ ] **blocker** a user cannot reference another user's account, category, template or occurrence —
      the composite `(sync_id, user_id)` foreign keys make it structurally impossible
- [ ] **blocker** two real test accounts confirm user A cannot read, write, update or delete user
      B's rows, and cannot reference B's rows from its own
- [ ] Anonymous callers hold no grant and can read nothing
- [ ] Session tokens appear in no backup, export, log or sync table
- [ ] Crash reporting, if enabled, carries no financial payload

## Sync engine

- [ ] **blocker** no queued local mutation can be lost — verified by the crash matrices
- [ ] **blocker** the cursor cannot advance past a change that was not applied
- [ ] **blocker** a deleted record cannot come back, in any device ordering
- [ ] **blocker** invalid remote data cannot reach SQLite
- [ ] **blocker** conflicts converge to one winner without oscillating
- [ ] Repeated syncs with no changes reach a fixed point and do no remote work
- [ ] A long offline period converges when the connection returns
- [ ] Retry storms leave the queue intact and the app responsive

## First link and account safety

- [ ] **blocker** initial sync cannot replace either side without an explicit confirmation
- [ ] **blocker** signing in as a different account cannot mix the two users' data
- [ ] Case A, B, C and D each behave as documented, including the safety backup
- [ ] An interrupted setup leaves the device unchanged and unlinked, and can be retried
- [ ] A backup restore on a linked device unlinks it and requires reconciliation
- [ ] Sign out warns about unsent changes and offers keep or remove, with the cloud untouched

## Multi-device

- [ ] Fresh device restore reproduces the source device's balances, dashboard, reports and people
      totals exactly
- [ ] Create, edit and delete converge in both directions
- [ ] Transfer keeps the total balance invariant, and income and expense unchanged
- [ ] Lending, borrowing and repayments converge with correct receivables and liabilities
- [ ] Three devices converge on one winner for a conflicting edit

## Budgets

- [ ] **blocker** spending is derived from transactions on every read — no `spent`, `remaining` or
      `percentage` is stored or synced as authoritative, locally or in the cloud
- [ ] **blocker** no month, currency and category can hold two live budgets, the overall budget
      (null category) included — the partial unique index over `coalesce(category, sentinel)` exists
      in **both** SQLite and PostgreSQL
- [ ] A budget is measured on `transactionDate`, never on when the row was written
- [ ] Month boundaries are exact: Jan 31/Feb 1, Feb 28/29, Mar 1, Apr 30/May 1, Dec 31/Jan 1
- [ ] Backdating, recategorising, editing and deleting an expense restate every affected month, and
      leave no phantom spending in the month it left
- [ ] Only the budget's own currency contributes; amounts in other currencies are never added in
- [ ] Spending exactly to the limit reads as reached (`at_budget`), not exceeded
- [ ] An extreme overspend reports its true percentage without overflowing or crashing
- [ ] A month with no budget says "no budget set" — never a limit of zero
- [ ] Changing the default currency does not rewrite a historical budget's currency
- [ ] The overall budget and the category budgets are never presented as one larger total
- [ ] Budget round-trips through backup, and an older backup restores with no budgets

## Recurring transactions

- [ ] **blocker** the same occurrence cannot produce two financial transactions — enforced by the
      unique index on `transactions.recurring_occurrence_id` and the derived identity, not by the UI
- [ ] **blocker** two devices generating the same date offline converge on one occurrence and one
      transaction
- [ ] **blocker** generation is atomic: the occurrence, its queue entry and its transaction are one
      SQLite transaction, so no generated occurrence can exist without its transaction
- [ ] **blocker** monthly recurrence does not drift — the anchor is computed from the start date, so
      a short February never becomes the new anchor
- [ ] Generate-versus-skip converges deterministically, with generated winning
- [ ] Deleting a generated transaction leaves the occurrence handled and never regenerates it
- [ ] Deleting or pausing a template stops future occurrences and keeps every transaction it made
- [ ] Editing a template changes future generations only; past transactions are untouched
- [ ] Editing a generated transaction's date moves the money, and does **not** rewrite the
      occurrence's scheduled date
- [ ] Day-28, 29, 30 and 31 monthly anchors and a yearly February 29 behave as documented in
      `docs/recurring-m8c.md`
- [ ] Due enumeration is bounded and chronological: the oldest dates are returned first and the rest
      are reported through `hasMore`, never silently dropped
- [ ] Generation works entirely offline, and a large batch pushes in dependency-safe order
- [ ] Templates, occurrences and generated transactions round-trip through backup, and a backup with
      a duplicate or underived identity is refused before the database is touched

## Receipt scanning

- [ ] **blocker** no transaction exists before Save Expense — capturing, reading and reviewing a
      receipt change no balance, budget, report or outbox entry
- [ ] **blocker** `features/receipts/review/receipt-save.service.ts` is the only receipt file that
      can create money, and it creates an ordinary expense through the transaction service
- [ ] **blocker** a receipt saves once: a double tap, a stale screen or a retry finds the draft
      finalized
- [ ] **blocker** Save Expense is one SQLite transaction: no expense exists while its draft still
      reads as unsaved, so a crash or a failed write cannot turn the next save into a duplicate
- [ ] **blocker** receipt photos, OCR text and drafts never reach the backup, Cloud Sync or a log
- [ ] A photo no draft points at — a failed delete, or a capture killed before it was registered —
      is removed by the next sweep once it is older than a draft's lifetime
- [ ] Category and account are always chosen by the person; nothing is inferred from a merchant or
      a card
- [ ] A default date is never shown as detected, and uncertain fields say so in words
- [ ] A refused save leaves the review and its draft intact
- [ ] A build with no OCR engine does not offer Scan Receipt
- [ ] **external** an on-device OCR engine is installed and verified on Android and iOS
      development builds
- [ ] Camera, photo import, review and Save Expense verified on a real Android and iOS device,
      including large text and a small screen

## AI category suggestions (M9C)

- [ ] **blocker** no provider key, service-role key or AI-related `EXPO_PUBLIC_` variable anywhere
      in the app, its config or its bundle (`test/ai/ai-boundary.test.ts`)
- [ ] **blocker** `features/ai` references no transaction, repository, database, outbox or backup
      API; a suggestion creates no transaction, balance, report, budget or outbox change
- [ ] **blocker** a suggestion never selects a category by arriving; Save Expense stays disabled
      until a person chooses one, and a later choice always wins
- [ ] **blocker** the request carries only `version`, `merchantText` and category `id`/`name`; no
      image, OCR text, amount, date, account or note
- [ ] **blocker** server and app each reject a category outside the request's set, and any
      malformed or over-length answer, whole
- [ ] **blocker** the quota migration is applied and `supabase/tests/ai-suggestion-quota.sql` passes
- [ ] Suggestions are off until the person agrees, and Local Only reviews and saves receipts with
      no Cloud Account
- [ ] Suggestions pause quietly, as explanations do, during a Cloud Sync account mismatch, first
      link or reconciliation
- [ ] Function logs contain metadata only (`requestId`, status, timings, token counts)
- [ ] **external** `ANTHROPIC_API_KEY` set with `supabase secrets set` on staging and production,
      never in `.env` or Git; `supabase functions deploy suggest-expense-category` done per project
- [ ] **external** one synthetic request against staging returns a validated suggestion (no real
      receipt); a request without a session returns 401; the seventh in a minute returns 429
- [ ] **external** the Anthropic organization's data-retention arrangement is confirmed before any
      copy says more than what is sent
- [ ] **external** consent card, suggestion card, merchant card, loading and failure states verified
      on Android and iOS, in both themes and at large text

## Spending Insights (M9D)

- [ ] **blocker** `features/insights`, `features/ai/insights` and the Spending Insights screen import
      no write function, database, SQL or outbox handle (`test/insights/insight-readonly.test.ts`)
- [ ] **blocker** a hundred questions, including change requests and injected instructions, change no
      table, balance or outbox entry
- [ ] **blocker** each intent's context carries only its sections, and never a transaction list,
      notes other than largest-expense descriptions, contact details or identifiers
- [ ] **blocker** no figure adds two currencies; a comparison with a zero previous period has no
      percentage
- [ ] **blocker** the server and the app each reject an explanation containing a number the context
      does not
- [ ] **blocker** the insight quota migration is applied and `supabase/tests/ai-insight-quota.sql`
      passes
- [ ] Insight cards and "From your records" figures work offline, signed out and with AI off
- [ ] Explanations pause during a Cloud Sync account mismatch
- [ ] **external** `explain-financial-insight` deployed per project; one synthetic question returns a
      grounded explanation; a request without a session returns 401; the sixth in a minute returns
      429
- [ ] **external** Spending Insights verified on Android and iOS in both themes, at large text, on a
      small screen and with a screen reader

## Receipt and AI production hardening (M9E)

See [`ai-receipt-hardening-m9e.md`](ai-receipt-hardening-m9e.md) for the audit behind these.

- [ ] **blocker** no file under `src`, `supabase` or `test` contains a NUL byte, and app and function
      code write invisible characters as escapes, so no change to a sanitiser can reach review as a
      binary file with no diff (`test/security/source-hygiene.test.ts`)
- [ ] **blocker** every `console` call in the app is behind `__DEV__`: SQLite driver errors quote the
      failed statement's parameters, and a release build's console reaches the system log
- [ ] CI runs every receipt, AI and insights suite with mock providers; no job needs an AI credential
- [ ] **external** `react-native-worklets` is installed before any release build — Expo Doctor
      reports it as a missing required peer of Reanimated (not introduced by M9)
- [ ] **external** a deployment that overrides `AI_SUGGESTION_MODEL` or `AI_INSIGHT_MODEL` names a
      model that accepts `output_config.effort`; one that does not (Claude Haiku 4.5) fails every
      request closed as "not configured"
- [ ] **external** on Android and iOS preview builds: camera, photo import, OCR, review, Save
      Expense, an AI suggestion and an AI explanation, each also offline, signed out and with the app
      killed mid-step

## Investments (M10A)

See [`investments-m10a.md`](investments-m10a.md).

- [ ] **blocker** a buy moves cash out and a sale moves cash in through one linked transaction each;
      neither changes Income, Expense, Savings or any budget, and a balance counts the cash once
- [ ] **blocker** a trade, its cash and both queue entries are one SQLite transaction; editing or
      deleting a trade changes its cash with it, and the ordinary transaction service refuses to
- [ ] **blocker** no change — local, downloaded, restored or uploaded — can leave any asset selling
      more than it held at any point in its history
- [ ] **blocker** two devices selling the same units offline: the second upload is refused by the
      cloud and the download is refused on the device; neither ever holds a negative position
- [ ] **blocker** quantities are integer 10^-8 units, money is integer minor units, products are
      BigInt, and a figure that does not fit is refused
- [ ] **blocker** an unpriced position has an unknown value, never zero; no total adds two currencies
- [ ] **blocker** `supabase/migrations/20260915000000_investments.sql` applied and
      `supabase/tests/investments.sql` passing before a build containing M10A syncs
- [ ] A dividend is Investment Return income: Bank +500, Income +500
- [ ] Total Balance stays cash in accounts; Investment Value is a separate figure
- [ ] Backup version 5 round-trips investments; versions 1–4 restore with none
- [ ] `verifySyncIntegrity()` reports no investment issue on a representative dataset
- [ ] 100 assets, 5,000 trades and 1,000 prices summarize within the performance test's budget

## Performance

- [ ] A large dataset (5,000+ transactions) uploads and restores in bounded batches
- [ ] Incremental sync stays incremental: one change is one change
- [ ] A no-change sync makes one change-feed request and no row fetches
- [ ] Dashboard and reports load acceptably on the restored device
- [ ] A month's budgets are answered by one grouped aggregate, not one spending query per budget
- [ ] Home's budget and recurring summaries stay bounded: no full-table scan per card
- [ ] 100+ budgets, 100+ templates and 100 due occurrences render through virtualized lists

## Release build verification

- [ ] Android preview or production build installs and runs
- [ ] iOS preview or production build installs and runs
- [ ] Cloud Sync completes a full first link and a two-device pass on real hardware
- [ ] Cloud Sync screens, alerts and destructive confirmations are readable with a screen reader

## Sign-off

- [ ] Every blocker above is green
- [ ] Anything untested is written down as an external verification item, not assumed
- [ ] `docs/sync-invariants.md` still matches the code, and its tests pass
- [ ] `verifySyncIntegrity()` reports no issues on a representative dataset — see
      `docs/budgets-recurring-m8e.md`
