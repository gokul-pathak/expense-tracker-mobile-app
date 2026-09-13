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

## Receipts and AI category suggestions

Receipt scanning reads the photograph **on the device**. The photo, the text read from it and the
draft stay on the device and are never backed up or synchronized.

AI category suggestions are **optional and off until the person agrees**, on the review screen or
in Settings. They need a signed-in Cloud Account; Local Only works fully without them. When they are
on, reviewing a receipt sends, over TLS, to this app's own Supabase Edge Function:

- the merchant name read from the receipt, after phone numbers, card numbers, email addresses,
  links and labelled identifiers such as loyalty or VAT numbers are removed where recognizable
- the names of the person's current expense categories, under throwaway ids (`c1`, `c2`…)

The function forwards those to the configured AI provider (Anthropic's Claude API) and returns a
suggested category, a cleaner merchant name and a one-sentence reason. **The photo, the receipt's
text, the amount, date, currency, payment mode, account, notes, balances, budgets, people and
transaction history are never sent.** Removal of identifiers is pattern-based and cannot recognize
everything; the stronger protection is that only a merchant name is sent at all.

The suggestion is advice shown on the review screen. It is not stored, not backed up and not
synchronized, and it changes nothing until the person taps it and saves the expense. The function
logs technical metadata — a request id, status, timing and token counts — and never the text it was
sent or the answer. A per-account request count is kept in the cloud to limit cost; it holds counts
only. How the AI provider retains API data is described, with its sources, in
[`ai-assistance-architecture.md`](ai-assistance-architecture.md#provider-data-handling).

The on/off choice is a device preference, like the theme: it is not synchronized to other devices.

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
