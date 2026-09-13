# Receipts

A photograph of a receipt, read by an OCR engine, turned into a **draft**. That is all M9A does. It
creates no transaction, shows no screen, and sends nothing off the device.

The one thing to know before changing anything here: **OCR output is untrusted, and a draft is not
money.** A statistical model reading a crumpled photograph produces evidence, not a record. Nothing
in this feature may reach a balance, a budget, a report or the outbox — The single
exception is `review/receipt-save.service.ts`, which turns a reviewed draft into an ordinary
expense only when a person presses Save Expense.

The second thing: **every field can be null, and a failure is not an empty draft.** An unreadable
receipt yields `status: 'failed'` with a reason. It must never yield an expense of 0.00, which is a
lie that looks like data and is exactly what a tired person would confirm by tapping through a
review screen.

## Layout

| Path                                     | What it is                                                         |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `capture/receipt-capture.service.ts`     | the only file that imports `expo-image-picker`                     |
| `capture/receipt-files.ts` (+ `.web.ts`) | the private working directory and its lifecycle                    |
| `ocr/receipt-ocr.ts`                     | the provider interface, and the `unavailable` default              |
| `extraction/`                            | pure functions: normalise, money, amount, date, merchant, currency |
| `receipt-draft.repository.ts`            | the local-only `receipt_drafts` table                              |
| `receipt-processing.service.ts`          | orchestration, states, and the stale-result guard                  |
| `scanner/receipt-scanner.state.ts`       | the pure state machine behind Scan Receipt                         |
| `review/receipt-review.model.ts`         | what Review Receipt prefills, flags, requires and saves            |
| `review/receipt-save.service.ts`         | **the only file here that creates money** — Save Expense           |

`extraction/` takes text and context and returns a draft. No clock, no database, no settings
lookup — which is what makes `test/receipts/receipt-parser.test.ts` a specification rather than a
snapshot. Keep it that way.

## Things that look like bugs and are not

- **`accountId` and `categoryId` are always `null`.** A receipt cannot know which account paid, and
  `VISA ****1234` names a card, not an account. Category guessing is M9C's, done deliberately.
- **Conflicting totals produce no amount.** Two lines both claiming to be the total return `null`
  with the candidates exposed. Picking one would be a coin toss presented as a reading.
- **`03/04/2026` produces no date.** It is two different days and the paper does not say which.
- **`Rs` does not mean NPR.** It means NPR or INR, so it falls through to the labelled default.
- **The largest number is ignored.** On `TOTAL 500 / CASH 1000 / CHANGE 500` it is twice the bill.

## Privacy

Receipt images, raw OCR text and draft candidates are local-only: excluded from the backup, absent
from Cloud Sync, and never logged. The feature contains no `console.*` call and no network call at
all, and `test/receipts/receipt-privacy.test.ts` fails if either appears.

Read [`docs/receipt-scanning-architecture.md`](../../../docs/receipt-scanning-architecture.md)
before adding an OCR engine, persisting raw text, or putting a receipt anywhere near the sync feed.
