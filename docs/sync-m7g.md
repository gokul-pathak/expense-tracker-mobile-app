# M7G Cloud Sync hardening and release audit

M7G answers one question: **can this cloud-sync implementation safely be released?** It adds almost
no product surface. It tests, audits, hardens, fixes what the audit found, and writes down what a
future maintainer needs to know.

Two real defects surfaced and were fixed. Both are recorded below rather than quietly patched,
because the reasoning matters more than the diff.

## What the audit found

### 1. A deleted record could come back (fixed)

The sync cycle ran push → pull. A device that edited a record while offline would upload that edit
_before_ learning that another device had deleted the record. Uploads are unconditional upserts
keyed by identity, so the edit overwrote the tombstone, and the next pull brought the record back on
every device.

This is the "deleted rows resurrect" release blocker, and it only appears with three ingredients:
an offline edit, a deletion elsewhere, and the upload going first.

**The cycle is now pull → push, with a short read-back afterwards.** Downloading first means the
tombstone arrives before the upload is even considered; delete-wins removes the stale queue entry;
nothing resurrects. The read-back exists so the cursor keeps up with this device's own uploads —
without it, every cycle that sent something would leave the next one re-downloading it, and no run
would ever be a true no-op.

The cost is that a local change waits one round trip longer to leave the device. That is the right
trade: a slow upload is an inconvenience, a resurrected transaction is a wrong balance.

Covered by `test/sync/sync-orchestration.test.ts` and the three-device deletion test in
`test/sync/multi-device.test.ts`.

### 2. A large first link left the device behind (fixed)

After the initial upload, reconciliation pulls to establish the cursor and the per-record baselines.
That pull used the ordinary run bound — 20 batches of 100 — so a device with 5,000 records finished
linking with its cursor thousands of changes behind. It was correct (the rows were already local)
but every one of the next few syncs was heavy.

Measured on this machine: the first incremental sync after linking a 5,000-transaction device took
**4,836 ms**. With the convergence pull allowed to finish its own upload, the same sync takes
**57 ms**. Setup pays once instead of every sync afterwards paying a little.

### 3. A device cannot carry its records into a different account (documented, not a defect)

Records keep the identity they were given under the first account, and the database refuses to let a
second account write over an identity it does not own — that refusal is row level security working.
Keeping the data and linking to a _different_ account therefore fails, safely: nothing is uploaded,
nothing is re-homed, and the device stays unlinked.

The path that works is **Remove From This Device**, then link; or back up, link, and restore. This
is now in the runbook and covered by `test/sync/account-safety.test.ts`.

The test harness was also made faithful here: the in-memory cloud now refuses an upsert onto an
identity owned by someone else, exactly as the database does.

## What was added

**A local integrity verifier** — `src/features/sync/dev/verify-sync-integrity.ts`. It audits
identities, the queue, the binding, the cursor, the baselines and relation integrity, and returns
codes and counts. It **reports and never repairs**: an automatic "fix" for a duplicate identity or an
orphaned queue entry is how a transaction disappears without anyone deciding it should. Its output
carries no amounts, names or notes, so a report is safe to paste into an issue.

**A written invariant list** — `docs/sync-invariants.md`. Thirty-five properties, each naming the
test that fails if it stops being true.

**Crash matrices** — `test/sync/crash-recovery.test.ts`, 20 tests covering interruption at every
stage of upload, download and first link, including the case where the server committed but the
device never heard back, and a restart between the two.

**Stress and convergence** — `test/sync/sync-stress.test.ts`, 29 tests: a thousand queued mutations
across bounded runs, restart durability, retry storms in both directions, concurrent cycles, a
session that disappears mid-cycle, an account that changes mid-cycle, a week offline, identity
collision, and the fixed-point property.

**Three devices** — `test/sync/multi-device.test.ts`. Two devices prove sync works; three prove it
converges, that a conflict resolves to one winner rather than oscillating, and that no pair can
settle into a state the third disagrees with.

**A repo-wide security audit** — `test/sync/security-audit.test.ts`, 21 tests. No service-role key
anywhere, session material confined to the platform secure store, App Lock credentials absent from
every sync path and from the cloud schema, no logging from the engine, nothing sensitive in a backup
or an export, and untrusted-remote-row defences.

**Cloud-side suites** — `supabase/tests/rls-matrix.sql` (46 assertions: every table, every
operation, both directions, grants, cross-user foreign keys) and `supabase/tests/integrity.sql`
(22 assertions: the database refuses invalid financial data on its own).

**CI** — `.github/workflows/ci.yml`. One job for typecheck, lint, the whole offline suite and the web
bundle, needing no credentials. A second job starts local Supabase, applies migrations from version
control, and runs every SQL suite. The security job is deliberately not `continue-on-error`: a
security regression that only warns is a security regression that ships.

**Retry backoff** — automatic foreground sync now backs off after consecutive failures, from one
minute up to fifteen, resetting on success. Sync Now ignores it entirely: a person who taps a button
is not made to wait.

## Measured performance

Five accounts, 25 categories, 50 people, 5,000 transactions, on this machine (Node, on-disk SQLite,
in-memory cloud, no network). Real numbers from `test/sync/performance.test.ts`; a phone on a real
network will differ, and these are not a substitute for measuring one.

| Operation                                                                   | Time     |
| --------------------------------------------------------------------------- | -------- |
| Initial upload of the whole device, including safety backup and convergence | 7.9 s    |
| Fresh device restore: download, validate, atomic replacement                | 4.7 s    |
| Incremental sync on the device that changed                                 | 57 ms    |
| Incremental sync on the other device                                        | 28 ms    |
| Sync with nothing to do                                                     | 16 ms    |
| Dashboard after restore                                                     | 17–19 ms |
| Report after restore                                                        | 2 ms     |

Request shape matters more than the clock: the upload of 5,080 rows used batches of at most 100 and
fewer than 500 requests in total, and a no-change sync makes exactly one change-feed request and no
row fetches.

## Still true, and still deliberate

- No Realtime, no OS background sync, no multiple cloud profiles in one database.
- Tombstones are retained. A retention horizon needs an all-devices-safe design and is not something
  to guess at for a first release.
- No "delete all cloud data" action. Signing out is not deletion, and the app does not claim it is.
- Local Only remains a complete product: no account, no network, every feature.

## Known limitations

- **The SQL suites have never been executed here.** Docker is unavailable in this environment, so
  `rls.sql`, `rls-matrix.sql`, `integrity.sql`, `push.sql`, `pull.sql` and `reconciliation.sql` are
  written and committed but unrun. Running them is a release gate, not an optional extra.
- **No real device or hosted project has been exercised.** Every result here comes from the offline
  suite against real SQLite and an in-memory cloud.
- **Case D replaces one side.** Merging two divergent datasets is still deferred.
- **A device cannot carry its records into a different account**, as described above.
- **`.env` in this workspace uses `NEXT_PUBLIC_` names**, so the app runs Local Only until they are
  renamed to `EXPO_PUBLIC_`.
