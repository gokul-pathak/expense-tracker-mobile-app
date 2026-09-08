# M7F Cloud Sync UX and First-Link Reconciliation

M7F is the milestone where cloud sync becomes something a person can actually turn on. It adds the
Cloud Sync screen, the first-link flows, the sync orchestrator behind **Sync Now**, foreground
syncing, and the sign-out and account-switch protections. It adds no realtime, no OS background
work, and no second dataset for a second account.

Implementation rules live next to the code in `src/features/sync/README.md`. This document records
the decisions that refine `cloud-sync-architecture.md` (M7A) and the operational notes.

## The rule the whole milestone turns on

**Authentication is not linking.** Signing in proves who someone is. It says nothing about whether
the financial records on this device belong to that account. A database becomes linked only when a
reconciliation completes, and until then no financial byte moves in either direction.

That is why `sync_state` now carries three separate facts rather than one:

- `linked_user_id` — the account this database has finished agreeing with. The engines act only on
  this.
- `pending_link_user_id` — the account a reconciliation is currently working towards. A run that
  fails leaves this cleared and the binding untouched, so a half-finished setup is resumable rather
  than a database that claims a relationship it never established.
- `reconciliation_required` — the local dataset was replaced underneath a link (today only by a
  backup restore). Sync stays blocked until the user chooses again.

## Decisions that refine M7A

1. **"Meaningful data" is a domain judgement, not a row count.** Accounts, transactions, people,
   user-created categories and a changed default currency count. Seeded built-in categories and an
   untouched settings row do not — every fresh install has them, and counting them would make every
   first link look like the dangerous both-populated case. The outbox is deliberately not consulted:
   records that predate it have no queued work, so a long-standing local database would look empty.
2. **The initial upload is its own operation.** Push reads the outbox, which is right for
   propagating changes and wrong for a first upload. `performInitialUpload()` reads the current
   dataset directly and upserts it by identity. Push's semantics are untouched, and nothing fakes an
   upload by manufacturing thousands of mutations.
3. **"Use this device's data" retires the cloud rows this device does not have.** Uploading alone
   would leave the other device's records in the cloud, and the very next pull would download them
   straight back. They are tombstoned, not hard-deleted, so the retirement travels to other devices
   as an ordinary deletion.
4. **The binding is committed last, and the outbox is cleared with it.** On the local-data path the
   upload plus the pull that follows have just proven the cloud holds this exact dataset, and user
   writes were suspended throughout, so nothing queued can still be unsent intent.
5. **Reconciliation composes the other engines.** It holds the shared engine lock and drives push
   and pull as nested steps; a second reconciliation, or an independent sync, is still turned away.
6. **User writes are suspended for the critical section.** `enqueueSyncMutation` — the one function
   every user-originated write already goes through — refuses while a reconciliation runs. Remote
   apply and migrations are unaffected, which is exactly the distinction needed: a transaction added
   between "snapshot taken" and "upload finished" would otherwise be captured by neither side.
7. **A backup restore unlinks the device.** Restoring replaces the dataset a cloud link was built
   on, so the link is dropped and `reconciliation_required` is set. Without that, the next push
   would quietly overwrite newer cloud data with an older backup.
8. **Settings adopt the cloud's identity before upload.** The cloud identifies a settings row by its
   owner, so uploading this device's row under a different `sync_id` retires the cloud's one and
   orphans every change that referred to it. The local row adopts the cloud identity first. Pull
   also treats a change naming a settings identity that no longer exists as obsolete rather than
   missing — the one entity type where that is safe, because its identity is ownership.

## The four cases

| Case | This device | Cloud    | What happens                                             |
| ---- | ----------- | -------- | -------------------------------------------------------- |
| A    | empty       | empty    | Link. Nothing to protect, so no snapshot is taken.       |
| B    | has data    | empty    | Safety backup, full upload, pull to converge, then link. |
| C    | empty       | has data | Download, validate, atomic local replacement, then link. |
| D    | has data    | has data | Explicit choice. Never merged. Safety backup either way. |

Case D offers exactly two buttons, each stating its consequence in a full sentence — "Your cloud
financial data will be replaced by the data currently on this device", or the reverse — and each
confirmed on its own with the warning restated. There is no "Continue".

## Safety properties

- **Nothing destructive without a recovery snapshot.** A pre-link snapshot is written into the app's
  own storage first, in the same portable format Backup & Restore produces. If it cannot be written,
  setup stops.
- **Validate before replacing.** The whole cloud dataset is downloaded and checked — relations
  resolve, money is exact, transaction shapes hold, debt invariants hold — before a single local row
  is touched. Discovering a bad row after clearing the tables would leave a person with neither copy.
- **The local replacement is one transaction.** Either the device holds exactly the downloaded
  dataset, or exactly what it had.
- **A failed setup leaves the database unchanged and unlinked**, and says so.

## Sync cycle

`syncNow()` runs push → pull → push, bounded at two push passes. The second pass exists because a
pull that decides a local edit wins leaves that edit queued; without it the devices would stay
disagreeing while the screen said "Synced".

`last_successful_sync_at` moves only when the whole cycle succeeded and nothing is left queued.
"Synced" additionally requires a real binding, no attention-required records and no leftover error —
a successful network request on its own is never enough.

Foreground sync runs when the app becomes active, throttled to at most once a minute, and only from
inside the App Lock gate — a locked device syncs nothing, and the first sync happens after unlock.
There is no polling, no realtime subscription and no OS background task.

## Sign out, unlink, account switching

Signing out of a linked device is a data decision. Unsent changes are surfaced first, then the user
chooses:

- **Keep Data on This Device** — every record, identity and queued mutation stays; the binding, the
  cursor and the per-record baselines go. The device becomes local-only and can be reconciled again.
- **Remove From This Device** — the local copy is cleared and defaults are re-seeded. The cloud
  account is untouched, and the screen says so rather than implying a cloud deletion. App Lock lives
  outside SQLite and is deliberately left alone.

Signing in as a different account never mixes datasets: the status becomes `account_mismatch`, both
engines refuse, and the user must sign out and choose what happens to the local copy first. One
cloud user per local database remains the invariant.

## Known limitations

- **No merge.** Case D replaces one side. Combining two divergent datasets is deferred, and the
  wording says plainly which copy is being replaced.
- **The Case B path re-downloads what it just uploaded.** That pull is what establishes the cursor
  and the per-record baselines and proves the upload landed; on a very large first upload it is
  bandwidth spent on certainty.
- **Retiring obsolete cloud rows reads the whole cloud dataset.** Acceptable for a one-off
  reconciliation, and it is the only way to know which rows are obsolete.
- **A recovery snapshot is app-managed, not user-visible.** It is written to the app's document
  directory, so it does not survive uninstalling the app. Users who want a portable copy still use
  Backup & Restore.
- **`.env` in this workspace sets `NEXT_PUBLIC_SUPABASE_*`.** Expo reads `EXPO_PUBLIC_`-prefixed
  values, so the app currently runs in Local Only mode. Renaming the variables enables cloud sync;
  nothing in the app breaks without them.

## Verified externally

The offline suite covers the whole flow against a fake cloud and two real SQLite databases,
including the milestone's worked example figure for figure. What still needs a device and a real
project: the Supabase SQL suites (`supabase/tests/{rls,push,pull}.sql`, which need Docker and the
Supabase CLI), and manual Android/iOS passes over the setup screens, the alerts, and the
foreground-sync behaviour on a real app switch.

## Suggested M7G scope

Two-device hardening on real hardware and a real project; the RLS and push/pull SQL suites in CI;
an "Attention Required" review surface that can show and clear individual refused records; retention
for tombstones and the conflict log; and a development feature flag for staged rollout. Realtime, OS
background sync and multi-account databases stay out.
