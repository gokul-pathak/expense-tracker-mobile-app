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
- [ ] **blocker** `supabase/tests/integrity.sql` passes
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

## Performance

- [ ] A large dataset (5,000+ transactions) uploads and restores in bounded batches
- [ ] Incremental sync stays incremental: one change is one change
- [ ] A no-change sync makes one change-feed request and no row fetches
- [ ] Dashboard and reports load acceptably on the restored device

## Release build verification

- [ ] Android preview or production build installs and runs
- [ ] iOS preview or production build installs and runs
- [ ] Cloud Sync completes a full first link and a two-device pass on real hardware
- [ ] Cloud Sync screens, alerts and destructive confirmations are readable with a screen reader

## Sign-off

- [ ] Every blocker above is green
- [ ] Anything untested is written down as an external verification item, not assumed
- [ ] `docs/sync-invariants.md` still matches the code, and its tests pass
