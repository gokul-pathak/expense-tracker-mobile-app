# Investments (M10A)

M10A adds the investment domain: assets, the trades that move them, manual prices, and the
valuation derived from all three. There is no UI yet — M10B owns it — and no market feed,
brokerage link, crypto wallet, tax report, lot selection, derivative, short sale, margin or advice.

Everything here runs offline and with no Cloud Account.

## The accounting boundary

Buying shares is not an expense and selling them is not income. A buy moves cash out of an account
into an asset; a sale moves it back. So each trade writes **one linked cash transaction** whose
type keeps that meaning, and ordinary Income, Expense, Savings and Budgets never see capital moving:

| Trade    | Cash transaction                                         | Account | Amount      | Income / Expense / Savings / Budgets |
| -------- | -------------------------------------------------------- | ------- | ----------- | ------------------------------------ |
| buy      | `investment`                                             | out     | gross + fee | untouched                            |
| sell     | `investment_return`                                      | in      | gross − fee | untouched                            |
| dividend | `income`, in the built-in **Investment Return** category | in      | the amount  | Income +, Savings +                  |
| fee      | `investment`                                             | out     | the amount  | untouched                            |

`gross` is quantity × unit price, rounded half up to a minor unit.

- **`investment`** is cash paid out of an account for investment activity: a purchase with its fee,
  or a fee charged on its own.
- **`investment_return`** is capital coming back into an account from selling: the proceeds less the
  sell fee. It is the person's own money returning, never income, however much of it is gain.
- **A dividend is income**, because it is: cash the investment earned. The app already seeded an
  Investment Return income category for exactly this, so a dividend is an ordinary `income` row in
  it — Bank +500 and Income +500 — and budgets, which count only expenses, do not move.
- **Fees stay investment-specific.** A buy fee is part of what the units cost; a sell fee reduces what
  the sale returned; a standalone fee is counted on the asset. None creates an expense.

## Source of truth, and no double counting

- The **trade** is the source of quantity, cost basis and gains.
- The **linked transaction** (`transactions.investment_trade_id`) is the source of the cash.

Account balances, Home's Total Balance and every report read only transactions — the trades are
never summed into a balance. So Bank opening at 100,000, then buying 10 shares at 1,000 plus a fee of
100, is **89,900**: one cash row of 10,100, counted once.

A trade and its cash are written, changed and deleted together, with both sync queue entries, in one
SQLite transaction. The ordinary transaction service refuses to edit or delete a trade's cash —
including a dividend's income row — and says to change the trade instead.

**Total Balance stays cash in accounts.** Buying shares lowers it; what the shares are worth is a
separate figure, `marketValueMinor` on the portfolio summary (the Investment Value M10B will show),
and is never added to it. There is no Net Worth.

## Quantity and money

- **Money** is integer minor units, as everywhere in the app.
- **Quantity** is integer _quantity minor units_: `INVESTMENT_QUANTITY_SCALE` = **8** decimal places
  of one unit, so 1.23456789 shares is stored as 123,456,789. No `REAL`, no floats. Eight places
  covers fractional shares, fund units and the smallest unit of the common cryptocurrencies; the
  largest exact holding is about 90 million units.
- **Unit price** is minor units per whole unit. A price below one minor unit per unit is not
  representable.
- **Arithmetic** — every product and division — runs in BigInt (`investment-math.ts`) and is
  converted back to a number only after it is checked to fit. A figure that does not fit is refused
  with a `ValidationError`, never rounded into a plausible wrong one.
- **Rounding** happens in two places, both half up: a quantity's value at a price, and the share of
  cost basis a partial sale removes.

## Holdings, cost basis and gains

Nothing is stored. `investment-replay.ts` replays an asset's live trades every time.

**Weighted average cost** is the one method:

- A buy adds its quantity and adds gross + fee to the cost basis.
- A sale removes its quantity and the proportional share of cost basis, so the rest keeps the same
  average cost; selling everything takes the whole basis. **Realized gain** = (gross − sell fee) −
  the basis removed.
- A dividend and a standalone fee change neither quantity nor basis; each is totalled on its own.

The milestone example, tested permanently (`test/investments/investment-math.test.ts`,
`test/investments/investment-domain.test.ts`):

| Step                                | Bank   | Held | Cost basis | Realized | Value at 1,200 | Unrealized |
| ----------------------------------- | ------ | ---- | ---------- | -------- | -------------- | ---------- |
| Buy 10 at 1,000, fee 100            | 89,900 | 10   | 10,100     | —        | 12,000         | 1,900      |
| Sell 4 at 1,200, fee 50 (net 4,750) | 94,650 | 6    | 6,060      | 710      | 7,200          | 1,140      |
| Dividend 500 (Investment Return)    | 95,150 | 6    | 6,060      | 710      | 7,200          | 1,140      |

### Order

Trades replay by **trade date, then `createdAt`, then `syncId`**. All three travel with the trade, so
every device — and the cloud's holdings guard — replays in the same order. Trades on the same date
replay in the order they were entered: a new trade's `createdAt` is set after every trade already on
that date, so two entered within one millisecond cannot fall back to the random identity order.

### History changes

Creating, editing or deleting any trade replays the asset's whole history with the change in place,
and the change is refused if **any** sale, anywhere in it, would sell more than was held at that
point. A backdated buy can make a later sale valid; deleting an early buy that a later sale rests on
is refused. A trade's asset and type never change — a different asset or a different kind of event
is deleted and recorded again.

## Prices and valuation

- A price is a **calendar date** (`YYYY-MM-DD`) and a positive minor-unit amount, in the asset's
  currency. There is no market feed.
- A valuation uses the **latest price on or before** the day asked about (today by default); ties go
  to the one entered last.
- **Unknown is not zero.** A position nobody has priced has status `unpriced` and a null market value
  and unrealized gain. It is never valued at zero and never, silently, at its last purchase price.
- A position with nothing held is `closed`, worth zero.
- A history that sells more than it holds — only a corrupted database can contain one — is
  `invalid`: no figure is derived from it, and the summary lists it apart.

`portfolio.service.ts` exposes `getHolding`, `getAssetPerformance`, `listHoldings` and
`getPortfolioSummary`. The summary is **one entry per currency**; nothing converts. A currency's
`marketValueMinor` is null while any of its open positions is unpriced, and
`pricedMarketValueMinor` says how much of it is known.

A portfolio is read in three queries — assets, every live trade in replay order, the latest price
per asset — however many trades there are. 100 assets, 5,000 trades and 1,000 prices are summarized
well inside the test's budget (`test/investments/portfolio-performance.test.ts`).

## Cloud Sync

Three entity types, `investment_asset`, `investment_trade` and `investment_price`, each with a stable
UUID and the atomic outbox. Cloud tables are in `supabase/migrations/20260915000000_investments.sql`,
with ownership-safe composite foreign keys (a trade can reference only its owner's asset and
account; cash only its owner's trade), row level security forced and no grant to anon. Tested in
`supabase/tests/investments.sql`.

- **Push order:** accounts, then assets, then prices and trades, then the cash that names the trades.
- **Pull** validates each downloaded trade (asset and account exist and share its currency; the
  figures its type needs; positive cash) and price, and orders writes asset → prices and trades →
  cash. Investment cash is refused without its trade. A remote apply queues nothing.
- **Conflicts** are M7's record-level rules: a delete wins, and of two edits the local one resolves
  last. A trade's replay position travels with it, so both devices replay the same result.
- **New-device restore** validates the whole downloaded account, including replaying every asset,
  before anything replaces local data. **First upload** sends purchases before sales, and a
  Local-Wins replacement retires the cloud's own sales before uploading, so no batch ever leaves the
  cloud holding an impossible history.
- **Meaningful data:** an asset or trade makes a database, or an account, count as populated.

### Two devices selling the same shares

Both hold 10 shares. Offline, A sells 7 and B sells 7. Each is valid on its own phone. Together they
sell 14. This is refused in three places, and no device ever holds the combined history:

1. **The cloud** (`sync.guard_investment_holdings()`, a deferred constraint trigger) replays the
   asset's live trades after every write and refuses any statement that leaves a negative holding
   at any point. A uploads first and is accepted; B's upload of its sale is refused with `23514`, and
   B's sale stays queued.
2. **B's download** replays its local history — its own unsent sale included — with A's sale in
   place, finds it invalid, and refuses the change: the cursor stops and Cloud Sync shows
   **Attention Required**. B keeps 3 shares, never −4, and A's sale is never applied as if it were
   valid. This does not depend on which sale is earlier in time.
3. **The service** refuses any local change that would do the same.

A person resolves it on B by deleting or correcting one sale; the next sync converges both devices
(`test/sync/investment-sync.test.ts`).

## Backup

Backup version 5 adds assets, trades, prices and each transaction's `investmentTradeId`. Nothing
derived is written. Versions 1–4 still restore, with no investments.

Before the database is touched, a restore refuses: a negative or non-integer quantity, an unknown
trade type, a trade whose asset or account is missing, currencies that disagree, money outside the
safe integer range, duplicate identities, a history that sells more than it holds, investment cash
without a trade, a trade without cash, and cash that does not match its trade's type, amount,
account or date (`test/backup/investment-backup.test.ts`).

## Integrity verifier

`verifySyncIntegrity()` adds, report-only: `investment_trade_invalid`,
`investment_trade_invalid_relation`, `investment_negative_holding`, `investment_price_invalid`,
`investment_trade_without_cash`, `investment_cash_without_trade` and `investment_cash_mismatch`,
alongside the existing missing, invalid and duplicate identity checks, which now cover the three new
tables. It never repairs.

## Known limits

- One precision (8 places) for every asset, and prices to one minor unit per whole unit.
- No lots: FIFO, LIFO and specific identification are not supported, and neither is choosing a
  method.
- No splits, bonus shares, rights or other corporate actions.
- No FX. A trade's account must hold the asset's currency, and summaries are per currency.
- A push that splits a long run of offline edits to one asset across batches can, in contrived
  orderings, briefly present the cloud's guard with an intermediate history it refuses. The failed
  rows stay queued and go up on the next push.

## External verification

- `supabase db reset` and `supabase test db` against the new migration and `investments.sql` (the
  CI database job runs them; this environment has no Docker).
- The migration applied to staging and production before a build containing M10A syncs: pull
  requests `transactions.investment_trade_sync_id` and the three new tables.
