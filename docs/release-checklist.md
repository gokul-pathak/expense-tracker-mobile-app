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
