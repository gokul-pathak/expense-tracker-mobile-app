import type { InvestmentAssetType, InvestmentTradeType } from '@/db/constants';
import type {
  InvestmentAsset,
  InvestmentPrice,
  InvestmentTrade,
  NewInvestmentAsset,
  NewInvestmentPrice,
  NewInvestmentTrade,
} from '@/db/schema/investments';

export type { InvestmentAsset, InvestmentPrice, InvestmentTrade };

/**
 * Money is integer minor currency units and quantity is integer quantity minor
 * units (`INVESTMENT_QUANTITY_SCALE` places) everywhere in this feature, inputs
 * included. Parsing typed text into either is the caller's job — see
 * `parseQuantity` — so nothing below ever receives a float.
 */

export type CreateAssetInput = {
  name: string;
  symbol?: string | null;
  assetType: InvestmentAssetType;
  currency: string;
};

export type UpdateAssetInput = Partial<CreateAssetInput>;

export type BuyAssetInput = {
  assetId: number;
  /** Where the cash comes from. */
  accountId: number;
  quantityMinor: number;
  /** Price per whole unit. */
  unitPriceMinor: number;
  feeMinor?: number;
  tradeDate: Date;
  note?: string | null;
};

/** The same fields, with `accountId` the account the proceeds go to. */
export type SellAssetInput = BuyAssetInput;

export type RecordDividendInput = {
  assetId: number;
  /** Where the dividend is paid. */
  accountId: number;
  amountMinor: number;
  tradeDate: Date;
  note?: string | null;
};

/** A fee charged on its own rather than on a buy or a sell. */
export type RecordFeeInput = RecordDividendInput;

/**
 * What a trade may change. Its asset and its type never do: a sell that became a
 * buy, or moved to another asset, is a different event, and is deleted and
 * recorded again instead.
 */
export type UpdateTradeInput = {
  accountId?: number;
  quantityMinor?: number;
  unitPriceMinor?: number;
  feeMinor?: number;
  amountMinor?: number;
  tradeDate?: Date;
  note?: string | null;
};

export type AddPriceInput = {
  assetId: number;
  priceMinor: number;
  /** `YYYY-MM-DD`. */
  priceDate: string;
};

export type UpdatePriceInput = {
  priceMinor?: number;
  priceDate?: string;
};

export type CreateAssetRecord = Pick<
  NewInvestmentAsset,
  'name' | 'symbol' | 'assetType' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type UpdateAssetRecord = Pick<NewInvestmentAsset, 'updatedAt'> &
  Partial<Pick<NewInvestmentAsset, 'name' | 'symbol' | 'assetType' | 'currency' | 'isArchived'>>;

export type CreateTradeRecord = Pick<
  NewInvestmentTrade,
  | 'assetId'
  | 'accountId'
  | 'tradeType'
  | 'tradeDate'
  | 'quantityMinor'
  | 'unitPriceMinor'
  | 'feeMinor'
  | 'amountMinor'
  | 'currency'
  | 'note'
  | 'createdAt'
  | 'updatedAt'
>;

export type UpdateTradeRecord = Pick<NewInvestmentTrade, 'updatedAt'> &
  Partial<
    Pick<
      NewInvestmentTrade,
      | 'accountId'
      | 'tradeDate'
      | 'quantityMinor'
      | 'unitPriceMinor'
      | 'feeMinor'
      | 'amountMinor'
      | 'currency'
      | 'note'
    >
  >;

export type CreatePriceRecord = Pick<
  NewInvestmentPrice,
  'assetId' | 'priceMinor' | 'priceDate' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type UpdatePriceRecord = Pick<NewInvestmentPrice, 'updatedAt'> &
  Partial<Pick<NewInvestmentPrice, 'priceMinor' | 'priceDate'>>;

/** How a trade moves cash, and as which transaction. */
export type TradeCashEffect = {
  transactionType: 'investment' | 'investment_return' | 'income';
  /** `out` of the account for `investment`; `in` for the other two. */
  direction: 'out' | 'in';
  amountMinor: number;
};

export type PriceSnapshot = { priceMinor: number; priceDate: string };

/**
 * - `priced`: an open position with a price on or before today.
 * - `unpriced`: an open position nobody has priced. Its value is unknown, and
 *   is never reported as zero.
 * - `closed`: nothing is held, so there is nothing to value.
 * - `invalid`: the stored history sells more than it holds somewhere. No
 *   figure is derived from it; `verifySyncIntegrity` names the trade.
 */
export type HoldingStatus = 'priced' | 'unpriced' | 'closed' | 'invalid';

export type AssetHolding = {
  assetId: number;
  name: string;
  symbol: string | null;
  assetType: InvestmentAssetType;
  currency: string;
  isArchived: boolean;
  status: HoldingStatus;
  quantityMinor: number;
  costBasisMinor: number;
  /** Cost per whole unit, rounded, for display. Null when nothing is held. */
  averageUnitCostMinor: number | null;
  realizedGainMinor: number;
  dividendsMinor: number;
  otherFeesMinor: number;
  tradeCount: number;
  latestPrice: PriceSnapshot | null;
  /** Null unless `status` is `priced` or `closed`. */
  marketValueMinor: number | null;
  unrealizedGainMinor: number | null;
};

export type AssetPerformance = AssetHolding & {
  investedMinor: number;
  proceedsMinor: number;
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
};

/**
 * One currency's investments. No figure here adds two currencies, and none is
 * converted.
 *
 * `marketValueMinor` is the Investment Value: known only when every open
 * position in the currency is priced. While any is not, it is null, and
 * `pricedMarketValueMinor` says how much of it is known.
 */
export type CurrencyPortfolioSummary = {
  currency: string;
  assetCount: number;
  openPositionCount: number;
  pricedPositionCount: number;
  unpricedPositionCount: number;
  costBasisMinor: number;
  pricedCostBasisMinor: number;
  marketValueMinor: number | null;
  pricedMarketValueMinor: number;
  unrealizedGainMinor: number | null;
  pricedUnrealizedGainMinor: number;
  realizedGainMinor: number;
  dividendsMinor: number;
  otherFeesMinor: number;
};

export type PortfolioSummary = {
  currencies: CurrencyPortfolioSummary[];
  /** Assets whose history cannot be replayed. Counted nowhere above. */
  invalidAssetIds: number[];
};

/** A trade as an asset's history shows it: the trade, its cash, and the account it moved. */
export type TradeHistoryEntry = InvestmentTrade & {
  cashEffect: TradeCashEffect;
  /** Null only if the account row is missing, which the integrity verifier reports. */
  accountName: string | null;
};

/** Everything the asset screen shows, read in one pass. */
export type AssetDetail = {
  holding: AssetPerformance;
  /**
   * Newest first: replay order reversed, so trades on the same day keep the order
   * they were entered in rather than one invented for display.
   */
  history: TradeHistoryEntry[];
  /** The few most recent manual prices, newest first. */
  recentPrices: InvestmentPrice[];
  priceCount: number;
};

/** Every holding and the per-currency summary, from one replay of the portfolio. */
export type PortfolioOverview = { holdings: AssetHolding[]; summary: PortfolioSummary };

export type { InvestmentAssetType, InvestmentTradeType };
