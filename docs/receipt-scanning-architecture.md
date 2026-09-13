# Receipt scanning: architecture and boundaries (M9A)

M9A builds the machinery to turn a photograph of a receipt into a **draft**, and stops there. It
creates no transaction, shows no screen, and sends nothing anywhere.

```
Receipt image
  ↓  capture      expo-image-picker, copied into a private working directory
  ↓  OCR          a provider behind an interface; untrusted output
  ↓  normalise    Unicode, whitespace, lines preserved
  ↓  extract      deterministic, pure, no clock and no database
  ↓  draft        ReceiptExpenseDraft — every field nullable
  ↓  ─────────────────── M9A ends here ───────────────────
  ↓  review       M9B: a person checks and edits
  ↓  expense      M9B: an ordinary transaction, created explicitly
```

The rule the whole design serves: **OCR output is untrusted, and a draft is not money.** A
photograph read by a statistical model is evidence, not a record. Nothing in this pipeline can
change a balance, a budget, a report or a receivable, and the source-level test in
`test/receipts/receipt-privacy.test.ts` proves the capability is absent rather than merely unused.

## Image lifecycle

A picked image is copied immediately into `<cacheDirectory>/receipt-processing/`, under a random
filename. Three reasons:

- The picker's URI may point at a shared cache, a content provider, or somewhere the OS reclaims
  between the pick and the read.
- A filename chosen by another app is not a safe thing to build a path from.
- The app can then reason about a directory it owns.

These files are **processing artifacts, not financial records**. They are deleted when a draft is
discarded, when a draft expires, and (in M9B) when a transaction is finalised. The OS may also
delete them at any moment — caches are reclaimed under storage pressure with no warning — so
`receiptFileExists` is checked before every run and a missing file yields `image_unavailable`
rather than a crash.

Web has no staging at all: `receipt-files.web.ts` answers honestly instead of throwing, because
web already runs with SQLite closed (see `src/db/index.web.ts`).

## Privacy boundary

| Data             | Where it lives                           | Leaves the device |
| ---------------- | ---------------------------------------- | ----------------- |
| Receipt image    | private cache directory                  | **never**         |
| Raw OCR text     | memory, for the length of one extraction | **never**         |
| Draft candidates | `receipt_drafts`, local-only table       | **never**         |

Concretely, in M9A:

- **Not in the backup.** `createBackup` enumerates tables explicitly and `receipt_drafts` is not
  among them. Tested against the text of a receipt carrying a phone number, a tax id and a card
  fragment.
- **Not in Cloud Sync.** `receipt_drafts` has no `sync_id`, no `user_id`, no tombstone and no
  outbox entry, and `SYNC_ENTITY_TYPES` has no receipt member. Creating or processing a draft
  leaves pending sync work at exactly zero, so the app never shows unsent changes because someone
  photographed a receipt.
- **No Supabase table and no Supabase Storage.** None is added, deliberately.
- **Raw OCR text is never persisted.** The extracted candidates are columns; the page they came
  from is dropped when extraction finishes. Receipts print addresses, phone numbers, loyalty IDs
  and card fragments, and the cheapest way never to leak them is never to store them.
- **Nothing is logged.** The receipt feature contains no `console.*` call at all — enforced by
  test, because a single `console.log(ocrText)` added later would undo the rest of this table.
- **No network call of any kind.** No `fetch`, no Supabase client, no LLM, and therefore no key to
  hold. Also enforced by test.
- **Card digits never reach the draft.** Lines labelled as card, contact, reference or date are
  excluded from the amount candidates entirely, so `VISA ****4321` contributes no `4321`.

## Permissions

Requested only at the moment the corresponding action is taken, never at start-up.

| Permission    | When                                       | Copy                                                                        |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Camera        | the person chooses to photograph a receipt | says it is for scanning receipts, and that typing an expense never needs it |
| Photo library | the person chooses to import               | says it is for importing a receipt already taken                            |
| Microphone    | **never**                                  | `microphonePermission: false` in the `expo-image-picker` plugin             |

`exif: false` on both pickers: reading a receipt needs no location, and asking for it would attach
where someone was to what they bought. M9 adds no other permission — no notifications, no
background task, no contacts.

## OCR provider

```ts
type ReceiptOcrProvider = {
  readonly id: string;
  getCapability(): Promise<OcrCapability>; // available | unsupported | permission_denied
  recognize(image: ReceiptImageAsset): Promise<ReceiptOcrResult>;
};
```

Nothing downstream knows which engine ran, or whether one ran at all. `getCapability` returning
`unsupported` is an ordinary state — it is what web always returns, and what a build with no
engine returns — not an error and not a crash report.

**Provider confidence is kept separate from extraction confidence.** If an engine reports its own
probability it is carried as `providerConfidence`; it is never synthesized from the parser's
heuristics. "The model was sure" and "the word TOTAL was next to it" are different claims.

### No engine ships in M9A — see BLOCKER

M9A ships the abstraction, an `unavailable` default, and a fixture-driven fake used by the tests.
It ships **no bundled OCR engine**. The reasoning is in the completion report; in short, the
credible on-device candidates are all community native modules last published against older Expo
SDKs, none of them declares SDK 57 support, and this environment cannot produce an Android or iOS
build to verify that any of them compiles. Installing an unverifiable native dependency to make a
checklist item green is the failure mode the milestone explicitly warns against.

Wiring one in later is a contained change:

1. Add the dependency with `npx expo install`.
2. Write an adapter implementing `ReceiptOcrProvider`.
3. Call `setReceiptOcrProvider(adapter)` at start-up **behind a platform check**, so no native
   module is imported into the web bundle — importing it unconditionally is what breaks web, not
   running it.
4. Rebuild the development client. A native OCR module does **not** work in Expo Go, and no amount
   of JavaScript changes that; `npx expo start` against Expo Go will report the engine as
   unavailable, which is the honest result rather than a crash.

A cloud OCR service is **not** an alternative here. It would mean either shipping a credential in
the client — which this project forbids — or building a server-side proxy, which is a larger piece
of work than M9A and is not in scope.

## The draft

```ts
type ReceiptExpenseDraft = {
  transactionType: 'expense';
  amountMinor: ExtractedField<number>;
  currency: ExtractedField<string> & { source: CurrencySource };
  transactionDate: ExtractedField<LocalDate>;
  merchantName: ExtractedField<string>;
  paymentMode: ExtractedField<PaymentMode>;
  accountId: null; // never inferred
  categoryId: null; // never inferred
  amountCandidates: AmountCandidate[];
  parserVersion: number;
};
```

Every field is nullable, and a draft with only an amount is a good draft — M9B's review fills the
rest. A draft that found nothing is a **failure**, not an empty draft: an expense of 0.00 is a lie
that looks like data, and it is exactly what a tired person would confirm by tapping through.

- **`accountId` is never guessed.** A receipt cannot know which account paid. `VISA ****1234`
  identifies a card, not an account in this app; matching them needs a mapping only the user can
  make. M9B asks.
- **`categoryId` is never guessed.** No merchant-to-category lookup table. M9C will do this
  deliberately, with confidence and an explanation.
- **Only expenses.** A purchase receipt is money leaving. Income, transfers, lending, borrowing and
  repayments stay manual, because each needs invariants a photograph cannot establish.

### Confidence

Per field, deterministic, and derived only from evidence in the text. `basis` records _why_, which
is what lets a reviewer tell "the receipt did not say" from "it said something that could mean two
different things" — both of which produce `value: null`.

| Field    | high                                       | medium                                                                         | low                                                                         | none                                            |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Amount   | one strong total label, unambiguous figure | total recovered from the next line, or an OCR-repaired figure                  | subtotal only, or largest unlabelled number                                 | conflicting totals, or nothing found            |
| Date     | ISO, or a spelled month                    | numeric where one component exceeds 12; any future date is downgraded one step | two-digit year                                                              | ambiguous `03/04`, invalid day, or none printed |
| Currency | explicit supported code                    | —                                                                              | symbol that maps to exactly one supported currency; app default as fallback | two codes, or none and no default               |
| Merchant | first header line                          | second or third                                                                | fourth to sixth                                                             | nothing survived the filter                     |

## Amount extraction

Labels first, never size. **The largest number on a receipt is routinely not the total** — it is
the phone number, the invoice number, or the cash handed over:

```
TOTAL   500.00      ← the expense
CASH   1000.00      ← the largest number
CHANGE  500.00
```

Lines are classified before any number is read, in an order that matters: `SUB TOTAL` contains the
word `TOTAL`, so subtotal is recognised first or every subtotal would be read as a total.

- **Never the amount, never even a candidate:** reference (`INVOICE`, `BILL NO`, `VAT NO`, `PAN`),
  contact (`PHONE`, `TEL`), card (`VISA`, `EXPIRY`), and date lines. Their digits are identifiers.
- **Real money, but never selected automatically:** `SUBTOTAL`, `VAT`/`TAX`/`GST`, `TIP`, `CASH`,
  `TENDERED`, `CHANGE`. They stay in `amountCandidates` because a reviewer may want one.
- **Conflicting strong totals produce nothing.** `TOTAL 1,050` beside `GRAND TOTAL 7,050` returns
  `null` with basis `conflicting_total_labels` and both candidates exposed. Choosing between them
  would be a coin toss dressed up as extraction.

A `TOTAL` line with no figure beside it looks at the next line, which is how two-line receipt
layouts print, at reduced confidence.

## Money parsing

Integer minor units throughout, built by composing a canonical `123.45` string and handing it to
the app's own `parseMoneyToMinorUnits`. **No `parseFloat` touches money anywhere.** Amounts outside
the safe integer range are refused, not rounded. Zero and negative are refused: a minus on a
receipt is a refund line or a stray glyph, and neither is an expense total.

Separator rules, in order:

| Input                   | Reading                                | Why                                                             |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `1,234.56` / `1.234,56` | 123456                                 | both separators present — the **last** is the decimal           |
| `1.234.567`             | 123456700                              | one kind, repeated — grouping throughout                        |
| `1,24,500.00`           | 12450000                               | lakh grouping, as NPR and INR print it                          |
| `1 234.56`              | 123456                                 | space grouping, only when a decimal part proves it              |
| `123.45` / `12.5`       | 12345 / 1250                           | one separator, one or two digits after — a decimal              |
| `1.234`                 | 123400, **low**                        | genuinely ambiguous: 1234 grouped, or 1.234 with three decimals |
| `9812345678`            | flagged `bare_long_digit_run`, **low** | a long unseparated run is usually an identifier                 |

`1.234` is the case the milestone singles out, and it is **not** silently resolved. It is read as
grouped, marked `low`, and never promoted to a confident total on its own.

## Dates

`03/04/2026` is 4 March in London and 3 April in Chicago, and a photograph carries no locale. When
the digits alone do not settle it, extraction returns `null` with basis `ambiguous_numeric_date` —
distinguishable from `no_date_found`.

- ISO and spelled-month dates are high confidence.
- Numeric dates resolve only when one component exceeds 12.
- Invalid days (`2026-02-31`, `99/99/2026`) are refused, never rolled forward.
- A missing date stays missing. M9B may default visibly to today; extraction never does.
- A future date is kept but downgraded — probably OCR damage, but rewriting it to today would
  invent a date that appears on no receipt.
- `CARD EXPIRY` / `VALID THRU` / `DUE DATE` lines are excluded outright.

Time of day is not extracted; the app files transactions by date.

## Currency

`source` matters as much as `value`, because this app never converts between currencies and a
budget matches currency exactly — a wrong currency is not a slightly wrong number, it is an expense
that will never be counted against the budget the user expects.

| Source                      | Meaning                                                        | Confidence |
| --------------------------- | -------------------------------------------------------------- | ---------- |
| `explicit_receipt`          | a supported code printed on the paper                          | high       |
| `symbol_inference`          | a symbol mapping to exactly one supported currency (`$` → USD) | low        |
| `default_currency_fallback` | the app's setting standing in for silence                      | low        |
| `unknown`                   | two codes, or nothing and no default                           | none       |

`Rs` and `₹` mean both NPR and INR, so they settle nothing and fall through to the default rather
than picking a country. Currency is never inferred from the merchant's apparent nationality.

## Processing state and races

States: `captured` → `processing` → `ready_for_review` | `failed`. Failures carry a reason
(`no_text_detected`, `unsupported_image`, `image_unavailable`, `ocr_provider_unavailable`,
`ocr_failed`, `cancelled`) and never a draft.

**Stale results cannot overwrite newer ones.** Each run claims the draft and receives a generation
token; a write whose generation is no longer current is dropped and reported as `superseded`. So:
scan A, start OCR, replace with scan B, B finishes, A finishes last — A's result is discarded and
B's stands.

Retry reuses the staged image rather than asking for the receipt to be photographed again. Retries
are caller-driven; nothing retries by itself, and nothing retries forever.

## Cleanup

Drafts carry `expiresAt`, defaulting to seven days. The sweep removes expired drafts and their
images. Expiry is a stored date rather than a timer, so a draft being reviewed is never swept out
from under someone: `keepReceiptDraftAlive` pushes the date out. Cleanup reaches no financial
entity — there is no transaction to unwind, because scanning never created one.

## What M9A deliberately does not do

No scanner screen, no review screen, no "Scan receipt" button — M9B owns the user-facing workflow.
No AI, no LLM, no category suggestion, no merchant normalisation — M9C. No background scanning, no
notifications, no Realtime. No PDF receipts, no video, no multi-receipt splitting, no line-item
extraction. No bank integrations.

## Build requirements

`expo-image-picker` is a first-party Expo module bundled in Expo Go, so capture works in Expo Go
today. If an OCR engine with custom native code is added later, it will **not** work in Expo Go and
will require a development build (`npx expo run:android` / `run:ios`, or an EAS build) on both
platforms. That limitation is a property of native modules and must be documented rather than
worked around.
