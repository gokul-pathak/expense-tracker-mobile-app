# Production readiness (M10C)

The final hardening pass: an audit of every domain against its invariants, fixes for what failed,
and an honest list of what only a device, a build or a real Supabase project can prove. Feature
scope is frozen; nothing here adds a feature except where a release blocker required it.

## Blockers found and fixed

| Blocker                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                          | Proven by                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Currencies were added together.** Home's Total Balance and month card summed every account in every currency and printed the result in the default currency; Reports and People did the same, and a day total in the transaction list added rupees to dollars. | Home, Reports and People read one currency at a time. Home lists other currencies' balances on their own rows; Reports names the currencies it leaves out; People shows one total per currency; a day holding two currencies shows no total. | `test/release/full-accounting-audit.test.ts`, `test/ui/transaction-grouping.test.ts` |
| **App Lock unmounted the app whenever it went to the background.** On Android, opening the camera, the photo library or a document picker sends the app to the background, so the screen that asked for the photo was thrown away.                               | The privacy shield is drawn over the mounted app while it is unlocked. Locked, nothing financial is mounted at all, exactly as before.                                                                                                       | Code review; **device verification required**                                        |
| **A native peer dependency was missing.** `react-native-reanimated` needs `react-native-worklets` installed directly, and 14 Expo packages were behind the SDK's expected patch versions — Expo Doctor warned a build could crash outside Expo Go.               | Installed and aligned through `expo install`. Expo Doctor passes every check, and CI now runs it.                                                                                                                                            | `npx expo-doctor`: 21/21                                                             |
| **The Android build requested the microphone and overlay permissions.**                                                                                                                                                                                          | `android.blockedPermissions` removes `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW`.                                                                                                                                                               | `npx expo config --type introspect`                                                  |
| **New Account could be saved twice** by a second tap before the screen closed, doubling its opening balance in every total.                                                                                                                                      | A submit guard that stays set until the screen closes.                                                                                                                                                                                       | Code review                                                                          |

Also corrected: the privacy document listed only the M7 domains as synchronizing, described crash
reporting the app does not have, and did not say what each data action does. Settings → About now
gives version, schema, platform and sync state for a bug report, and nothing financial.

## Audit results

| Area                                   | Result                                                                                                                                                                    | Evidence                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Accounting semantics                   | Income ≠ Borrow, Expense ≠ Lend, Transfer neutral, repayments outside Income/Expense, Buy ≠ Expense, Sell ≠ Income, dividend is Investment Return income                  | `full-accounting-audit`                                                             |
| Canonical fixture                      | Cash 20,000 · Bank 158,150 · Total 178,150 · Income 65,500 · Expense 5,000 · Savings 60,500 · Ram owes 5,000 · owed to Sita 8,000 · 6 ABC, cost 6,060, realized 710       | `full-accounting-audit`                                                             |
| Account balances                       | Every balance equals opening balance plus the raw rows paid in minus the rows paid out; Total Balance is the accounts, each once; no stored balance                       | `full-accounting-audit`                                                             |
| Derived data                           | No table stores a balance, spent, remaining, holding, cost basis, gain or due count                                                                                       | `fresh-install`                                                                     |
| Expense mutations                      | Edit amount, account, category, date and delete each move balances, budgets and reports exactly once                                                                      | `full-accounting-audit`                                                             |
| Transfers, lending                     | Transfer neutral through edit, backdate, delete; overpayment refused both ways                                                                                            | `full-accounting-audit`, `test/financial`                                           |
| Budgets                                | Only expenses consume a budget; backdating moves spending to its month                                                                                                    | `full-accounting-audit`, `test/budgets`                                             |
| Recurring                              | Template, due date and skip move nothing; a generated date is one transaction however often it is generated                                                               | `full-accounting-audit`, `outbox-atomicity-domains`, `test/recurring`               |
| Receipts                               | Nothing financial exists before Save Expense; one expense after                                                                                                           | `test/receipts/receipt-save`                                                        |
| AI                                     | Optional, read-only, user-triggered; no financial write import, no SQL, no service key; bounded retries; no request on render or focus                                    | `test/ai/ai-boundary`, `test/insights/insight-readonly`, `test/ai/suggestion-state` |
| Investments                            | Local, backdated, edit-created, delete-created and two-device oversell all refused; fractional quantities exact                                                           | `test/investments`, `test/sync/investment-sync`                                     |
| Multi-currency                         | Home, Reports, People, transaction list, Budgets, Investments and AI context each one currency at a time                                                                  | `full-accounting-audit`, `test/insights`, `test/investments`                        |
| Sync fixed point                       | Three further syncs per device apply nothing, upload nothing, add no conflict and change no cloud row                                                                     | `sync-full-scenario`, `test/sync/sync-stress`                                       |
| Two and three devices                  | Every domain converges; a deletion survives a late edit; no duplicate cloud row; no negative holding; Food budget spending exact                                          | `sync-full-scenario`, `test/sync/multi-device`                                      |
| Tombstones                             | Transaction, budget, recurring template, investment trade and price: delete wins over an offline edit. Accounts, categories, people and assets archive rather than delete | `sync-full-scenario`, `test/sync/tombstone-regression`                              |
| Outbox atomicity                       | Every create, edit and delete of budgets, schedules and investments rolls back when the queue cannot be written                                                           | `outbox-atomicity-domains`, `test/sync/atomicity`                                   |
| Crash recovery, first link, new device | Push and pull crash matrices, all four link cases, full restore                                                                                                           | `test/sync/crash-recovery`, `reconciliation`, `new-device`                          |
| Account switching                      | A different account is blocked; Remove From This Device clears every domain                                                                                               | `test/sync/account-safety`, `replaceLocalDataFromRemote`                            |
| Secrets                                | No service-role key, AI key or admin credential in the client                                                                                                             | `test/sync/security-audit`, `test/ai/ai-boundary`                                   |
| Backup                                 | Full round trip identical; no lock, session, sync state, receipt or AI material; six kinds of damage refused before anything changes; versions 1–4 restore                | `backup-full-round-trip`, `test/backup`                                             |
| Migrations, install                    | M1 through M9 upgrade to the fresh-install schema; seeds never duplicate; no default budget, schedule or investment                                                       | `test/sync/migration-upgrade`, `fresh-install`                                      |
| Logging                                | Every console call is development-only; no crash reporter                                                                                                                 | `test/security/source-hygiene`                                                      |

## Large dataset

10 accounts, 30 categories, 100 people, 10,000 transactions (and 5,000 more that are investment cash),
120 budgets, 150 schedules, 1,000 recurring dates, 200 assets, 5,000 trades and 2,000 prices,
measured by `test/release/large-dataset.test.ts` during a full run on the development machine
(Windows, Node's SQLite). Statements are counted at `DatabaseSync.prepare`.

| Read                                           | Time     | Statements |
| ---------------------------------------------- | -------- | ---------- |
| Home (dashboard, budget, recurring, portfolio) | 124 ms   | 25         |
| Transactions list and search                   | 70 ms    | 1          |
| Reports, this year                             | 85 ms    | 12         |
| Budget month                                   | 7 ms     | 3          |
| Recurring list and due dates                   | 24 ms    | 4          |
| People                                         | 9 ms     | 2          |
| Portfolio                                      | 65 ms    | 3          |
| Asset detail                                   | 5 ms     | 5          |
| AI context builder                             | 27 ms    | 5          |
| Backup: create and serialize                   | 535 ms   | 14         |
| Backup: validate and restore                   | 7,336 ms | 23,632     |

No read's statement count grows with the data. Restore writes each row, so its statement count is
the row count by design; it runs inside one transaction after validation. Sync of a 5,000-transaction
device is covered by `test/sync/performance.test.ts`. None of these are device timings.

## Known limitations (not blockers)

- The Transactions tab lists the 500 most recent transactions in a scroll view, and search filters
  those 500. Older transactions still count everywhere else.
- Recurring's template list is a scroll view; it is bounded by the number of templates.
- A receipt draft that was never saved survives Remove From This Device until it expires.
- `getTotalBalance` in `account-balance.service.ts` still sums every currency; only the development
  verification harness calls it, and no screen does.
- The Android manifest keeps the storage permissions the SDK adds, and the resolved config does not
  list `CAMERA`; receipt capture on Android must be checked on a device.
- New Person and New Category have no double-submit guard; a duplicate there moves no money.

## External verification required

- `supabase db reset` and `supabase test db` — `rls.sql`, `rls-matrix.sql`, `integrity.sql`,
  `budgets.sql`, `recurring.sql`, `investments.sql` — in the CI database job or a local Docker
  Supabase. Any cross-user access is a release blocker.
- Android and iOS development, preview and production builds, with the main workflows on hardware:
  both themes, largest text, a small phone, keyboard open, TalkBack and VoiceOver, offline, signed
  out, App Lock cold start, resume, timeout, wrong PIN and biometrics, and the receipt camera and
  photo library returning to the review screen.
- Release configuration, which needs an owner's decision: app name, bundle and package identifiers
  (currently unset), icon, splash, build numbers, EAS build profiles, and one environment per
  build profile pointing at the matching Supabase project.
- A two-device Cloud Sync pass against a staging project.

## Readiness matrix

| Area              | Status                         |
| ----------------- | ------------------------------ |
| Core Accounting   | PASS                           |
| Accounts          | PASS                           |
| Income/Expense    | PASS                           |
| Transfers         | PASS                           |
| Lending           | PASS                           |
| Dashboard         | PASS                           |
| Reports           | PASS                           |
| Backup/Restore    | PASS                           |
| App Lock          | EXTERNAL VERIFICATION REQUIRED |
| Cloud Sync        | PASS (engine); RLS EXTERNAL    |
| Budgets           | PASS                           |
| Recurring         | PASS                           |
| Receipt Scanner   | EXTERNAL VERIFICATION REQUIRED |
| AI Categorization | PASS                           |
| AI Insights       | PASS                           |
| Investments       | PASS                           |
| Offline           | PASS                           |
| Security          | PASS; RLS EXTERNAL             |
| Privacy           | PASS                           |
| Accessibility     | EXTERNAL VERIFICATION REQUIRED |
| Performance       | PASS (local); device EXTERNAL  |
| Android Build     | EXTERNAL VERIFICATION REQUIRED |
| iOS Build         | EXTERNAL VERIFICATION REQUIRED |
| Web               | PASS                           |
