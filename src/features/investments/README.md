# Investments

Assets, the trades that move them, and manual prices that value them.

Domain (M10A):

- `investment.service.ts` — create, update and archive assets; buy, sell, dividend and fee; edit
  and delete trades; add, update and delete prices. Every trade change replays the asset's
  history first and is refused if any sell would exceed what was held at that point.
- `portfolio.service.ts` — holdings, asset performance and the per-currency portfolio summary,
  derived from source records on every read.
- `investment-replay.ts` — the pure weighted-average-cost replay. Order is trade date, then
  `createdAt`, then `syncId`, the same order the cloud's holdings guard uses.
- `investment-math.ts` — fixed-point quantity (8 decimal places) and BigInt money arithmetic.
- `investment.repository.ts` — reads and atomic writes. A trade, its linked cash transaction and
  both sync queue entries are one SQLite transaction.

Screens (M10B) — routes under `src/app/investments`, reached from More:

- `portfolio.service.ts` also serves the screens' read models: `getPortfolioOverview` (every holding
  and the per-currency summary from one replay) and `getAssetDetail` (holding, newest-first history
  with each trade's cash, recent prices).
- `trade-preview.service.ts` — what a buy or sale will do before it is recorded, and how much a sale
  on a given date may take. It uses the arithmetic and the replay recording uses, so a preview
  cannot disagree with the saved trade.
- `investment-presentation.ts` — every word, sign, ordering and accessibility label the screens use.
  It formats figures; it never computes one.
- `investment.errors.ts` — typed refusals, so a screen can say "This change would make later
  investment history invalid." without matching on message text.
- `TradeForm`, `CashEventForm`, `PriceForm`, `HoldingRow`, `TradeHistoryRow`,
  `PortfolioSummaryCard`, `GainLine`, `FigureRow`, `CardListItem`, `InvestmentSyncNotice` — screen
  parts composed from `src/components/ui`.

The accounting rules — which cash transaction each trade writes, why a sale is not income, why a
dividend is — and the screen flows are in [`docs/investments.md`](../../../docs/investments.md).
