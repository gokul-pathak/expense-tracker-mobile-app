# Cloud Sync runbook

Operational notes for developing, testing and diagnosing cloud sync. No secrets belong in this file
or in any file committed to this repository.

## Environments

The app reads two public values:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

They are client identifiers, not secrets, and they are the only cloud configuration the app has.
There is no service-role key, no database password and no admin token anywhere in the client — a
test fails the build if one appears.

With either value missing the app runs in **Local Only** mode: every financial feature works, and
the Cloud Sync screen explains that sync is unavailable in this build. That is also the safe way to
run a development build that must not touch a real project.

Keep one `.env` per environment and never point a development build at production data:

| Environment | Supabase project                 | Used for                                      |
| ----------- | -------------------------------- | --------------------------------------------- |
| local       | `supabase start` on this machine | tests, migrations, RLS suites                 |
| staging     | a separate hosted project        | manual multi-device passes with test accounts |
| production  | the live project                 | released builds only                          |

> The `.env` currently in this workspace defines `NEXT_PUBLIC_SUPABASE_*`. Expo only reads
> `EXPO_PUBLIC_`-prefixed variables, so the app runs Local Only until those are renamed.

## Running Supabase locally

```bash
npx supabase start          # needs Docker
npx supabase db reset       # recreate the schema from supabase/migrations
npx supabase test db        # run every suite in supabase/tests
npx supabase stop
```

`npm run cloud:status` lists applied migrations; `npm run cloud:push` applies them to the linked
project. Apply migrations to a hosted project only from version control — never by editing the
schema in the dashboard, or the next `db reset` silently diverges from production.

## The SQL suites

| Suite                               | Proves                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `supabase/tests/rls.sql`            | policy shape: own rows readable, foreign rows invisible                                         |
| `supabase/tests/rls-matrix.sql`     | the full matrix: every table, every operation, both directions, grants, cross-user foreign keys |
| `supabase/tests/integrity.sql`      | the database refuses invalid financial data on its own                                          |
| `supabase/tests/push.sql`           | the upload contract: idempotent replay, tombstones, one settings row                            |
| `supabase/tests/pull.sql`           | the change feed: one change per mutation, incremental reads, exact BIGINT                       |
| `supabase/tests/reconciliation.sql` | first-link contract: retryable upload, retirement, account isolation                            |
| `supabase/tests/budgets.sql`        | budget isolation, ownership-safe category reference, and one live plan per month                |

A failure in `rls.sql`, `rls-matrix.sql` or `integrity.sql` is a release blocker. Do not mark those
optional in CI on an environment that can run them.

## The offline test suite

`npm test` needs no credentials, no Docker and no network. It runs the whole engine against an
in-memory cloud and real SQLite databases — including two- and three-device fixtures. Use it first:
it reproduces almost everything, in seconds.

```bash
npm test                                  # everything
npx vitest run test/sync                  # sync engine only
npx vitest run test/sync/multi-device.test.ts   # three-device convergence
npx vitest run test/sync/performance.test.ts --reporter=verbose  # prints real timings
```

## Diagnosing a device

`verifySyncIntegrity()` in `src/features/sync/dev/verify-sync-integrity.ts` audits a local database
and returns codes and counts — never amounts, names or notes, so its output is safe to paste into an
issue. It reports and never repairs: financial data that looks wrong is a question for a person.

```text
missing_sync_id / duplicate_sync_id     a row lost or shares its global identity
outbox_orphaned                         queued work whose record no longer exists
outbox_duplicate_identity               more than one live operation for one record
sync_state_dual_binding                 linked and mid-link at the same time
sync_state_cursor_without_link          a cursor left behind by an unlink
tombstoned_parent_in_use                a live transaction points at a deleted parent
transaction_orphaned_relation           a live transaction points at a missing row
budget_invalid_amount                   a budget amount is not a positive safe integer
budget_invalid_month                    a budget month is not YYYY-MM with a month in 01-12
budget_invalid_category                 a budget points at something that is not a live expense category
budget_duplicate_period                 two live plans for one month, currency and category
```

`verifySyncFoundation()` (`sync.verification.ts`) is the lighter development view: queue size by
entity type, binding, cursor, progress markers and whether an engine is running.

## Reading a status

| Status                    | What it means                                                    | What to do                                                                         |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `local_only`              | no account, or signed out and never linked                       | nothing; the app is complete like this                                             |
| `setup_required`          | signed in, not linked                                            | open Cloud Sync → Set Up Cloud Sync                                                |
| `pending_changes`         | queued work waiting to upload                                    | Sync Now, or wait for the next foreground sync                                     |
| `offline`                 | the last cycle could not reach the server                        | nothing; work is queued and retried, with a backing-off interval                   |
| `auth_required`           | the session expired or was revoked                               | sign in again; local data is untouched                                             |
| `account_mismatch`        | signed in as a different account than the device is linked to    | sign out, choose keep or remove, then link the other account                       |
| `reconciliation_required` | the dataset was replaced under the link, by a backup restore     | open Cloud Sync → Review Sync Status and choose which copy to keep                 |
| `attention_required`      | a record was refused, or a conflict could not be resolved safely | inspect `sync_conflicts` and the pull failures; the cursor is deliberately stopped |
| `synced`                  | binding valid, queue empty, no attention, no error               | nothing                                                                            |

## When sync is stuck at `attention_required`

The cursor stops before a record it refused, so the device stops making progress rather than
skipping data. That is deliberate. To diagnose:

1. Run `verifySyncIntegrity()` — a local problem shows up here.
2. Read `sync_conflicts` (identity, revisions, resolution) for what the engine decided.
3. Look at the refused record in the cloud by its `sync_id`. The common causes are a transaction
   whose relation is missing, an amount outside the safe integer range, or a debt sequence whose
   repayments exceed their principal.
4. Fix the record in the cloud, or delete it there as a tombstone. The next pull moves past it.

Do not "fix" it by advancing the cursor. That loses the record everywhere.

## Switching a device to a different cloud account

Records carry the identity they were given under the first account, and the database will not let a
second account write over an identity it does not own — that refusal is row level security doing its
job. So keeping the data and linking it to a different account does not work, and fails safely
rather than re-homing anything.

To move a device to another person's account, sign out and choose **Remove From This Device**, then
sign in and link. To move the _data_ to another account, export or back it up first, then restore it
after linking. Signing back into the same account always works and simply re-runs reconciliation.

## Resetting a test environment

```bash
npx supabase db reset        # cloud side: schema and data
```

On a device or emulator, uninstalling the app clears SQLite, SecureStore and the app-managed safety
backups. To keep the data but drop the cloud relationship, use Cloud Sync → Sign Out → **Keep Data
on This Device**.

## Two-device and three-device passes by hand

1. Sign in on device A, add accounts and transactions, run Set Up Cloud Sync (**Use This Device's
   Data**).
2. Install on device B, sign in with the same account, run Set Up Cloud Sync (**Restore From
   Cloud**).
3. Compare Home, Reports and People on both. They must match exactly.
4. Turn off the network on B, add records, turn it back on, Sync Now on both.
5. Edit the same transaction on both while B is offline; reconnect and sync both twice. One winner,
   both devices agreeing.
6. Delete a record on A, sync A, then sync B. It must not come back on either.

The same sequence is automated in `test/sync/multi-device.test.ts`; run it first and use the manual
pass to confirm the real network and real devices behave the same way.

## Safety backups

Before anything destructive, setup writes a snapshot into the app's document directory
(`safety-backups/`) in the same format as Backup & Restore. It is not offered through the share
sheet — the user is mid-setup and did not ask for a file picker. It does not survive uninstalling
the app, so a person who wants a portable copy should still use Backup & Restore.
