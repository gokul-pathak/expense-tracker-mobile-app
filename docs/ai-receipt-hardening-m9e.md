# Receipt and AI production hardening (M9E)

M9E adds no feature. It audits what M9A–M9D built — receipt capture, OCR, review and Save Expense;
AI category suggestions; Spending Insights explanations — against the release blockers for handling
photographs of receipts and sending financial context to a model. This file records what was
checked, what was wrong, what changed, and what still needs a device or a deployment.

## The two boundaries, unchanged

```text
Receipt image → on-device OCR → draft → person reviews → explicit Save Expense → ordinary expense
Local records → deterministic context builder → Edge Function → validated, read-only explanation
```

- A draft is not money. `features/receipts/review/receipt-save.service.ts` is the only receipt file
  that can write a transaction, and only when Save Expense is pressed
  (`test/receipts/receipt-privacy.test.ts`, `test/receipts/receipt-save.test.ts`).
- `features/ai`, `features/insights`, `features/ai/insights` and the Spending Insights screen import
  no write function, repository, database, SQL or outbox handle, and neither Edge Function gives the
  model a tool (`test/ai/ai-boundary.test.ts`, `test/insights/insight-readonly.test.ts`).

## Findings and fixes

| #   | Finding                                                                                                                                                                                                                                                                                                   | Severity                 | Fix                                                                                                                                                                                              | Proven by                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | Save Expense committed the expense and the draft's "saved" marker separately. A process kill, full disk or I/O error between them left an expense whose draft still read as unsaved; it reopened as a review, and saving again created a **duplicate expense**. Reproduced before the fix with a trigger. | **Blocker**              | The expense, its outbox entry and the finalization are one SQLite transaction (`prepareExpense` + `insertTransaction`). The finalization re-checks, inside it, that the draft is still saveable. | `receipt-save.test.ts` — "keeps no expense whose receipt could not be marked saved" |
| 2   | Both text sanitisers (`expense-suggestion.sanitize.ts`, `_shared/expense-suggestion/text.ts`) held raw NUL and direction-override characters in their regexes. Git treated them as binary, so every change to an AI security boundary reached review as "Bin" with no diff.                               | High (review blind spot) | Written as `\uXXXX` escapes. Every rewritten character class was checked to match exactly the same code points across the whole BMP. Also `receipt-text.ts` and two test fixtures.               | `test/security/source-hygiene.test.ts`                                              |
| 3   | 24 `console.error` calls in screens and forms ran in release builds. A Drizzle query error's message quotes the statement's parameters — an amount, a note, a person's name — and a release console reaches the device's system log.                                                                      | Medium (privacy)         | Every console call in the app is behind `__DEV__`.                                                                                                                                               | `source-hygiene.test.ts` — "happens only in development"                            |
| 4   | Photos that no draft referenced were never removed: `deleteStaleReceiptFiles` had no caller, and the draft sweep deletes the row before the file. A failed delete, or a capture killed before registration, left the photo in the cache indefinitely.                                                     | Medium (privacy)         | The sweep's second pass removes unreferenced photos older than a draft's lifetime, never one a live draft points at.                                                                             | `test/receipts/receipt-image-cleanup.test.ts`                                       |
| 5   | Category suggestions were still sent during a Cloud Sync account mismatch, under a session that does not own this device's records. Explanations already paused.                                                                                                                                          | Low                      | `suggestionAvailability` is `hidden` for `account_mismatch`, `linking` and `reconciliation_required`.                                                                                            | `test/ai/suggestion-state.test.ts`                                                  |
| 6   | "Keeps the raw OCR text out of the database" asserted the stored draft never contained `900` — including its millisecond timestamps, so it failed at random.                                                                                                                                              | Low (CI reliability)     | Timestamp fields are left out of the comparison.                                                                                                                                                 | `test/receipts/receipt-processing.test.ts`                                          |

## Audited, no change needed

- **Secrets.** No provider key, service-role key, secret key or AI-related `EXPO_PUBLIC_` variable
  in `src`, `app.json`, `.env.example` or `package.json`; the Anthropic SDK is a dev dependency only;
  `ANTHROPIC_API_KEY` is read only by the functions' `config.ts` (`ai-boundary.test.ts`).
- **Endpoint security.** Both handlers refuse, cheapest first: non-POST; a missing bearer token; a
  declared body over the limit; a token whose verified claims are not a signed-in, non-anonymous
  account (the user comes from claims, never the body); a body that exceeds the byte limit as it
  arrives; a strictly invalid request; no provider; quota exceeded or unknown (fail closed). The
  provider runs under a deadline; its answer is validated whole. Quotas are counted in Postgres as
  `auth.uid()`, 6/minute and 100/day for suggestions and 5/minute and 50/day for explanations, in an
  unexposed schema holding only counts (`suggestion-server.test.ts`, `insight-server.test.ts`,
  `supabase/tests/ai-*-quota.sql`).
- **Payload minimisation.** A suggestion request carries `version`, redacted `merchantText` and
  aliased category names — no image, OCR text, amount, date, account or note. An insight context
  carries only the sections its intent needs, aliases people, names accounts only when asked, and is
  bounded however large the history (`insight-large-dataset.test.ts`).
- **Prompt injection.** Hostile receipt text and notes are data inside a constant instruction. A
  category outside the request's set, extra fields, markup, links, a claim to have changed a record,
  or a number the context does not contain rejects the whole answer on the server and again on the
  device (`receipt-suggestion.test.ts`, `suggestion-server.test.ts`, `insight-assistant.test.ts`,
  `insight-server.test.ts`, `insight-readonly.test.ts`).
- **Deterministic money.** Every figure on Spending Insights and every "From your records" value is
  built on the device and rendered directly; the explanation beside it may only quote those numbers.
  No figure adds two currencies (`financial-context.test.ts`).
- **Stale answers.** Scanner runs, OCR generations, suggestion runs and insight runs each carry a
  token; a late result for an older receipt, draft or question changes nothing
  (`receipt-scanner-state.test.ts`, `receipt-processing.test.ts`, `suggestion-state.test.ts`,
  `insight-assistant.test.ts`).
- **Backup and sync.** Receipt drafts have no sync identity and no sync entity type; backups contain
  no receipt, suggestion, question or explanation; the AI preference is device storage only.
- **Permissions.** The resolved config asks for camera and photos (iOS usage strings for camera,
  photo library and Face ID only). Android's `RECORD_AUDIO` is written with `tools:node="remove"`;
  storage permissions are capped at SDK 32. No location, contacts, microphone, notification or
  background permission.
- **Web.** The web bundle exports; receipt scanning reports itself unavailable there, and the data
  boundary keeps SQLite-backed receipt and insight functions out of the web build.
- **CI.** `npm ci`, typecheck, lint, the whole Vitest suite (every M9 suite, with fake OCR and fake
  AI providers) and the web export run with no credentials; the database job runs the quota SQL tests.

## Cost

`claude-opus-5` at `effort: 'low'` is the default for both functions, with `max_tokens` of 1,024
(suggestions) and 2,048 (explanations), one SDK retry and server-side fallbacks. Requests happen only
on explicit actions: a suggestion when a reviewed receipt with a merchant is on screen and the person
has agreed, at most once per draft context and three times per review; an explanation when a
question is submitted, at most three times per question and twenty per visit. Nothing is requested
on render, focus, typing, start-up or foreground. The model is a deployment setting
(`AI_SUGGESTION_MODEL`, `AI_INSIGHT_MODEL`); both providers send `output_config.effort`, which Claude
Haiku 4.5 does not accept, so choosing it would make every request fail closed as "not configured".

## Known limits, not blockers

- **OS device backup.** Receipt photos live in the cache directory, which Android Auto Backup and
  iCloud backup exclude. The SQLite file — all financial data, including an unsaved draft's merchant,
  amount and date, never its photo or OCR text — follows the app's existing device-backup setting.
- **A draft abandoned by a kill mid-OCR** shows as "wasn't finished" if reopened and is otherwise
  swept with its photo when its seven days are up.
- **Grounding is a heuristic** (see `ai-financial-insights-architecture.md`): it stops invented and
  recomputed numbers, not a right number in the wrong sentence.
- **Expo Doctor** reports `react-native-worklets` missing as a required peer of Reanimated, and
  patch-level drift in fourteen Expo packages. Neither was introduced by M9.

## External verification

Not verifiable from this environment, and not claimed:

- Android and iOS preview or production builds; camera, photo import, OCR with a real on-device
  engine, review and Save Expense on hardware
- An AI suggestion and an AI explanation against a deployed staging project; 401 without a session;
  429 past the quota; the quota migrations applied
- Screen reader, large text and small-screen passes of Scan Receipt, Review Receipt, suggestion
  cards and Spending Insights (the source carries spoken labels, live regions and words for every
  state that is also shown by colour)
- The Anthropic organization's data-retention arrangement
