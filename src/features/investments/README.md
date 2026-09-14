# Investments

Assets, the trades that move them, and manual prices that value them. No UI yet (M10B).

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

The accounting rules — which cash transaction each trade writes, why a sale is not income, why a
dividend is — are in [`docs/investments-m10a.md`](../../../docs/investments-m10a.md).
