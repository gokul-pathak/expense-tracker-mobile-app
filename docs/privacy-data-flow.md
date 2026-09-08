# Privacy and data flow

What this app stores, where it goes, and what it deliberately does not do. Written to be accurate
rather than reassuring: a claim here that the code does not back up is a defect.

## Local Only, by default

Without a cloud account, financial data exists in one place: the SQLite database inside this app's
private storage on the device. No account is required, no network is required, and every feature
works — accounts, transactions, transfers, lending and borrowing, dashboard, reports, backup,
export and App Lock.

## What synchronizes, once someone opts in

Cloud Sync is off until a person signs in **and** completes setup. Signing in alone moves nothing.
Once a device is linked, these source records synchronize with that person's own Supabase account:

- accounts, including opening balance, type, currency and archive state
- categories, including which are built in
- people
- transactions of every type, with their amounts, dates, titles and notes
- the default-currency setting

Deletions travel too, as tombstones, so a record deleted on one device disappears on the others
rather than coming back.

## What never synchronizes

- **App Lock credentials.** The PIN, its salt and verifier, the biometric preference, the auto-lock
  setting and failed-attempt state live in the device keystore and never enter SQLite, a backup, an
  export or the cloud. A second device configures its own lock.
- **Session tokens.** Access and refresh tokens live in the platform secure store only.
- **Derived figures.** Balances, dashboard totals, savings, category percentages, report figures and
  receivable or liability totals are never uploaded. Every device recomputes them from the source
  records, which is why two devices agree.
- **Local bookkeeping.** The sync queue, cursor, per-record baselines, conflict log, attempt counters
  and migration state are specific to one installation and stay there.

## Where the data goes

```text
this device
  SQLite  ──►  Cloud Sync engine  ──►  Supabase (this user's rows only)
    ▲                                        │
    └──────────  Cloud Sync engine  ◄────────┘
```

Screens read SQLite and nothing else. The engine is the only thing that talks to Supabase, always as
the signed-in user, so the database's row level security applies to every statement. There is no
service-role key in the app.

Isolation is enforced by the database, not by the app: every cloud row carries its owner, policies
compare that owner to the authenticated user, and cross-user references are rejected outright. The
client checks ownership again on everything it downloads, because a client that trusts the server
completely has no defence left if that assumption ever breaks.

## Encryption

Data is encrypted in transit (TLS) and at rest by the cloud provider. **This is not end-to-end
encryption.** The provider — and anyone with administrative access to the project — can technically
read stored rows. Nothing in this app claims otherwise, and no marketing copy should.

## Backups and exports

Manual backup and export are separate from Cloud Sync and remain under the user's control. A backup
carries the global identity of each record, so restoring keeps cloud identity, but it never carries
session tokens, sync bookkeeping or App Lock credentials. Cloud setup also writes an automatic
recovery snapshot into the app's own storage before anything destructive; it is not shared anywhere
and is removed when the app is uninstalled.

## Diagnostics

Sync failures are reported through typed status codes. Durable failure metadata is a short
classification such as `network` or `constraint` — never a response body, a row, or a token. If
crash reporting is enabled in a build, an unexpected sync exception may be sent with technical
context only: the operation, the entity type and an error category. Amounts, notes, names, account
names and email addresses are deliberately excluded.

## Deleting data

- **Remove From This Device** clears the local copy and unlinks the device. The cloud account keeps
  its data and can be downloaded again by signing in.
- Deleting the cloud account itself is not implemented in the app. Signing out is not deletion, and
  the app does not claim it is.
