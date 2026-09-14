import { getAccountById } from '@/features/accounts/account.repository';
import { NotFoundError, ValidationError } from '@/features/shared/errors';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';
import type {
  CreateTransactionRecord,
  UpdateTransactionRecord,
} from '@/features/transactions/transaction.types';

import * as repository from './investment.repository';
import { formatQuantity, toSafeInteger, valueAtPrice } from './investment-math';
import { replayTrades, type HoldingPosition, type ReplayTrade } from './investment-replay';
import type {
  AddPriceInput,
  BuyAssetInput,
  CreateAssetInput,
  CreateTradeRecord,
  InvestmentAsset,
  InvestmentPrice,
  InvestmentTrade,
  RecordDividendInput,
  RecordFeeInput,
  SellAssetInput,
  TradeCashEffect,
  UpdateAssetInput,
  UpdateAssetRecord,
  UpdatePriceInput,
  UpdatePriceRecord,
  UpdateTradeInput,
  UpdateTradeRecord,
} from './investment.types';
import {
  normalizeAssetName,
  normalizeAssetSymbol,
  normalizeAssetType,
  normalizeFeeMinor,
  normalizeInvestmentCurrency,
  normalizeOptionalNote,
  normalizePositiveMinor,
  normalizePriceDate,
  normalizeQuantityMinor,
  normalizeTradeDate,
} from './investment.validation';

/**
 * Investments: assets, the trades that move them, and the prices that value them.
 *
 * **The accounting boundary.** Buying shares is not an expense and selling them
 * is not income. A buy moves cash out of an account into an asset; a sell moves
 * it back. So each trade writes one linked cash transaction whose type keeps
 * that meaning, and ordinary Income, Expense, Savings and Budgets never see it:
 *
 * | Trade    | Cash transaction    | Account | Amount                    | Reports and budgets |
 * | -------- | ------------------- | ------- | ------------------------- | ------------------- |
 * | buy      | `investment`        | out     | gross + fee               | untouched           |
 * | sell     | `investment_return` | in      | gross − fee               | untouched           |
 * | dividend | `income`            | in      | the dividend              | Income +, in the built-in Investment Return category |
 * | fee      | `investment`        | out     | the fee                   | untouched           |
 *
 * A dividend is the one that counts as income, because it is: cash the
 * investment earned, which this app already files under Investment Return.
 * Money from a sale is the person's own capital coming back and never counts.
 *
 * **History is replayed before it changes.** Creating, editing or deleting any
 * trade replays the asset's whole history with the change in place, and the
 * change is refused if any sell anywhere in it would sell more than was held at
 * that point. A backdated buy can make a later sell valid; deleting an early buy
 * can make a later sell invalid, and is refused.
 */

export const INVESTMENT_RETURN_CATEGORY_KEY = 'income_investment_return';

/** Deliberately generic: renaming an asset must not leave stale titles on its cash. */
const CASH_TITLES = {
  buy: 'Investment Purchase',
  sell: 'Investment Sale',
  dividend: 'Dividend',
  fee: 'Investment Fee',
} as const;

const OVERSELL_MESSAGE =
  'This would sell more units than are held at that point in the asset’s history.';

// Assets

export function createAsset(input: CreateAssetInput): InvestmentAsset {
  const now = new Date();
  return repository.createAsset({
    name: normalizeAssetName(input.name),
    symbol: normalizeAssetSymbol(input.symbol),
    assetType: normalizeAssetType(input.assetType),
    currency: normalizeInvestmentCurrency(input.currency),
    createdAt: now,
    updatedAt: now,
  });
}

export function updateAsset(id: number, input: UpdateAssetInput): InvestmentAsset {
  const current = getAsset(id);
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one asset field to update.');
  }
  const data: Omit<UpdateAssetRecord, 'updatedAt'> = {};
  if (input.name !== undefined) data.name = normalizeAssetName(input.name);
  if (input.symbol !== undefined) data.symbol = normalizeAssetSymbol(input.symbol);
  if (input.assetType !== undefined) data.assetType = normalizeAssetType(input.assetType);
  if (input.currency !== undefined) {
    const currency = normalizeInvestmentCurrency(input.currency);
    if (
      currency !== current.currency &&
      (repository.countLiveTradesForAsset(id) > 0 || repository.countLivePricesForAsset(id) > 0)
    ) {
      throw new ValidationError('An asset’s currency cannot change once it has trades or prices.');
    }
    data.currency = currency;
  }
  return repository.updateAsset(id, { ...data, updatedAt: new Date() }) ?? assetNotFound(id);
}

/** Hidden from new trades. Everything it holds still counts. */
export function archiveAsset(id: number): InvestmentAsset {
  getAsset(id);
  return (
    repository.updateAsset(id, { isArchived: true, updatedAt: new Date() }) ?? assetNotFound(id)
  );
}

export function unarchiveAsset(id: number): InvestmentAsset {
  getAsset(id);
  return (
    repository.updateAsset(id, { isArchived: false, updatedAt: new Date() }) ?? assetNotFound(id)
  );
}

export function getAsset(id: number): InvestmentAsset {
  return repository.getAssetById(id) ?? assetNotFound(id);
}

export function listAssets(): InvestmentAsset[] {
  return repository.listAssets();
}

// Trades

export function buyAsset(input: BuyAssetInput): InvestmentTrade {
  return recordQuantityTrade('buy', input);
}

export function sellAsset(input: SellAssetInput): InvestmentTrade {
  return recordQuantityTrade('sell', input);
}

export function recordDividend(input: RecordDividendInput): InvestmentTrade {
  return recordAmountTrade('dividend', input);
}

export function recordFee(input: RecordFeeInput): InvestmentTrade {
  return recordAmountTrade('fee', input);
}

export function getTrade(id: number): InvestmentTrade {
  return repository.getTradeById(id) ?? tradeNotFound(id);
}

export function listTrades(assetId: number): InvestmentTrade[] {
  getAsset(assetId);
  return repository.listTradesForAsset(assetId);
}

/**
 * Changes a trade and its cash together.
 *
 * Its asset and its type never change: a different asset or a different kind of
 * event is a different trade, deleted and recorded again.
 */
export function updateTrade(id: number, input: UpdateTradeInput): InvestmentTrade {
  const current = getTrade(id);
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one trade field to update.');
  }
  const asset = getAsset(current.assetId);
  const quantityTrade = current.tradeType === 'buy' || current.tradeType === 'sell';
  if (quantityTrade && input.amountMinor !== undefined) {
    throw new ValidationError(`A ${current.tradeType} has a quantity and a price, not an amount.`);
  }
  if (
    !quantityTrade &&
    (input.quantityMinor !== undefined ||
      input.unitPriceMinor !== undefined ||
      input.feeMinor !== undefined)
  ) {
    throw new ValidationError(`A ${current.tradeType} has an amount, not a quantity or a price.`);
  }

  const data: Omit<UpdateTradeRecord, 'updatedAt'> = {};
  if (input.accountId !== undefined)
    data.accountId = requireTradeAccount(asset, input.accountId).id;
  if (input.tradeDate !== undefined) data.tradeDate = normalizeTradeDate(input.tradeDate);
  if (input.quantityMinor !== undefined) {
    data.quantityMinor = normalizeQuantityMinor(input.quantityMinor);
  }
  if (input.unitPriceMinor !== undefined) {
    data.unitPriceMinor = normalizePositiveMinor(input.unitPriceMinor, 'Unit price');
  }
  if (input.feeMinor !== undefined) data.feeMinor = normalizeFeeMinor(input.feeMinor);
  if (input.amountMinor !== undefined) {
    data.amountMinor = normalizePositiveMinor(input.amountMinor, 'Amount');
  }
  if (input.note !== undefined) data.note = normalizeOptionalNote(input.note) ?? null;

  const next: InvestmentTrade = { ...current, ...data };
  const syncId = requireSyncId(current.syncId, 'investment trade');
  assertValidHistory(asset.id, { replace: toReplayTrade(next, syncId) });

  const now = new Date();
  const effect = cashEffectOf(next);
  const cash: UpdateTransactionRecord = {
    amountMinor: effect.amountMinor,
    currency: next.currency,
    sourceAccountId: effect.direction === 'out' ? next.accountId : null,
    destinationAccountId: effect.direction === 'in' ? next.accountId : null,
    transactionDate: next.tradeDate,
    note: next.note,
    updatedAt: now,
  };
  return repository.updateTradeWithCash(id, { ...data, updatedAt: now }, cash) ?? tradeNotFound(id);
}

/** Refused when a later sell depends on the units this trade provided. */
export function deleteTrade(id: number): InvestmentTrade {
  const current = getTrade(id);
  assertValidHistory(current.assetId, {
    removeSyncId: requireSyncId(current.syncId, 'investment trade'),
  });
  return repository.deleteTradeWithCash(id, new Date()) ?? tradeNotFound(id);
}

/**
 * How a trade moves cash, and as which transaction.
 *
 * Refuses a trade whose cash cannot be a positive amount: a purchase worth less
 * than one minor unit, or a sale whose fee swallows its proceeds.
 */
export function cashEffectOf(
  trade: Pick<
    InvestmentTrade,
    'tradeType' | 'quantityMinor' | 'unitPriceMinor' | 'feeMinor' | 'amountMinor'
  >,
): TradeCashEffect {
  switch (trade.tradeType) {
    case 'buy': {
      const gross = grossOf(trade);
      return {
        transactionType: 'investment',
        direction: 'out',
        amountMinor: toSafeInteger(gross + BigInt(trade.feeMinor), 'Purchase cost'),
      };
    }
    case 'sell': {
      const net = grossOf(trade) - BigInt(trade.feeMinor);
      if (net <= BigInt(0)) {
        throw new ValidationError('The fee must be less than the sale proceeds.');
      }
      return {
        transactionType: 'investment_return',
        direction: 'in',
        amountMinor: toSafeInteger(net, 'Sale proceeds'),
      };
    }
    case 'dividend':
      return {
        transactionType: 'income',
        direction: 'in',
        amountMinor: requireAmount(trade.amountMinor),
      };
    case 'fee':
      return {
        transactionType: 'investment',
        direction: 'out',
        amountMinor: requireAmount(trade.amountMinor),
      };
  }
}

// Prices

export function addPrice(input: AddPriceInput): InvestmentPrice {
  const asset = getAsset(input.assetId);
  const now = new Date();
  return repository.insertPrice({
    assetId: asset.id,
    priceMinor: normalizePositiveMinor(input.priceMinor, 'Price'),
    priceDate: normalizePriceDate(input.priceDate),
    currency: asset.currency,
    createdAt: now,
    updatedAt: now,
  });
}

export function updatePrice(id: number, input: UpdatePriceInput): InvestmentPrice {
  getPrice(id);
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one price field to update.');
  }
  const data: Omit<UpdatePriceRecord, 'updatedAt'> = {};
  if (input.priceMinor !== undefined) {
    data.priceMinor = normalizePositiveMinor(input.priceMinor, 'Price');
  }
  if (input.priceDate !== undefined) data.priceDate = normalizePriceDate(input.priceDate);
  return repository.updatePrice(id, { ...data, updatedAt: new Date() }) ?? priceNotFound(id);
}

export function deletePrice(id: number): InvestmentPrice {
  getPrice(id);
  return repository.deletePrice(id, new Date()) ?? priceNotFound(id);
}

export function getPrice(id: number): InvestmentPrice {
  return repository.getPriceById(id) ?? priceNotFound(id);
}

/** Newest first. */
export function listPrices(assetId: number): InvestmentPrice[] {
  getAsset(assetId);
  return repository.listPricesForAsset(assetId);
}

// Internals

/** The shape every stored trade is replayed in. */
export function toReplayTrade(trade: InvestmentTrade, syncId?: string): ReplayTrade {
  return {
    syncId: syncId ?? requireSyncId(trade.syncId, 'investment trade'),
    tradeType: trade.tradeType,
    tradeDate: trade.tradeDate.getTime(),
    createdAt: trade.createdAt.getTime(),
    quantityMinor: trade.quantityMinor,
    unitPriceMinor: trade.unitPriceMinor,
    feeMinor: trade.feeMinor,
    amountMinor: trade.amountMinor,
  };
}

function recordQuantityTrade(
  tradeType: 'buy' | 'sell',
  input: BuyAssetInput | SellAssetInput,
): InvestmentTrade {
  const asset = requireActiveAsset(input.assetId);
  const account = requireTradeAccount(asset, input.accountId);
  const now = new Date();
  return createTrade(
    {
      assetId: asset.id,
      accountId: account.id,
      tradeType,
      tradeDate: normalizeTradeDate(input.tradeDate),
      quantityMinor: normalizeQuantityMinor(input.quantityMinor),
      unitPriceMinor: normalizePositiveMinor(input.unitPriceMinor, 'Unit price'),
      feeMinor: normalizeFeeMinor(input.feeMinor),
      amountMinor: null,
      currency: asset.currency,
      note: normalizeOptionalNote(input.note) ?? null,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

function recordAmountTrade(
  tradeType: 'dividend' | 'fee',
  input: RecordDividendInput | RecordFeeInput,
): InvestmentTrade {
  const asset = requireActiveAsset(input.assetId);
  const account = requireTradeAccount(asset, input.accountId);
  const now = new Date();
  return createTrade(
    {
      assetId: asset.id,
      accountId: account.id,
      tradeType,
      tradeDate: normalizeTradeDate(input.tradeDate),
      quantityMinor: null,
      unitPriceMinor: null,
      feeMinor: 0,
      amountMinor: normalizePositiveMinor(input.amountMinor, 'Amount'),
      currency: asset.currency,
      note: normalizeOptionalNote(input.note) ?? null,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

function createTrade(input: CreateTradeRecord, now: Date): InvestmentTrade {
  // The identity is fixed first, so the history is validated in exactly the
  // order it will be stored and replayed.
  const syncId = createSyncId();
  const existing = repository.listTradesForAsset(input.assetId);

  // Trades with the same date replay in entry order. Two entered within one
  // millisecond would otherwise fall back to identity order, which is random, so
  // a new trade always lands after every trade already recorded for its date.
  const tradeDate = input.tradeDate.getTime();
  const lastForDate = existing.reduce(
    (latest, trade) =>
      trade.tradeDate.getTime() === tradeDate
        ? Math.max(latest, trade.createdAt.getTime())
        : latest,
    Number.NEGATIVE_INFINITY,
  );
  const record: CreateTradeRecord = {
    ...input,
    createdAt: new Date(Math.max(input.createdAt.getTime(), lastForDate + 1)),
  };

  const effect = cashEffectOf({
    tradeType: record.tradeType,
    quantityMinor: record.quantityMinor ?? null,
    unitPriceMinor: record.unitPriceMinor ?? null,
    feeMinor: record.feeMinor ?? 0,
    amountMinor: record.amountMinor ?? null,
  });
  assertValidHistory(
    record.assetId,
    {
      add: {
        syncId,
        tradeType: record.tradeType,
        tradeDate,
        createdAt: record.createdAt.getTime(),
        quantityMinor: record.quantityMinor ?? null,
        unitPriceMinor: record.unitPriceMinor ?? null,
        feeMinor: record.feeMinor ?? 0,
        amountMinor: record.amountMinor ?? null,
      },
    },
    existing,
  );

  const cash: CreateTransactionRecord = {
    type: effect.transactionType,
    amountMinor: effect.amountMinor,
    currency: record.currency,
    categoryId: record.tradeType === 'dividend' ? requireInvestmentReturnCategory() : null,
    sourceAccountId: effect.direction === 'out' ? record.accountId : null,
    destinationAccountId: effect.direction === 'in' ? record.accountId : null,
    personId: null,
    paymentMode: null,
    transactionDate: record.tradeDate,
    title: CASH_TITLES[record.tradeType],
    note: record.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return repository.insertTradeWithCash(syncId, record, cash).trade;
}

type HistoryChange = { add?: ReplayTrade; replace?: ReplayTrade; removeSyncId?: string };

/**
 * Replays the asset's history with a change in place, and refuses the change if
 * the result is not a history that could have happened — or holds a figure too
 * large to record exactly.
 */
function assertValidHistory(
  assetId: number,
  change: HistoryChange,
  existing: readonly InvestmentTrade[] = repository.listTradesForAsset(assetId),
): HoldingPosition {
  let trades = existing.map((trade) => toReplayTrade(trade));
  if (change.removeSyncId !== undefined) {
    trades = trades.filter((trade) => trade.syncId !== change.removeSyncId);
  }
  if (change.replace !== undefined) {
    const replacement = change.replace;
    trades = trades.map((trade) => (trade.syncId === replacement.syncId ? replacement : trade));
  }
  if (change.add !== undefined) trades = [...trades, change.add];

  const result = replayTrades(trades);
  if (!result.ok) {
    throw new ValidationError(
      `${OVERSELL_MESSAGE} Held ${formatQuantity(result.violation.heldQuantityMinor)}, selling ${formatQuantity(result.violation.soldQuantityMinor)}.`,
    );
  }
  const { position } = result;
  toSafeInteger(position.quantityMinor, 'Holding quantity');
  toSafeInteger(position.costBasisMinor, 'Cost basis');
  toSafeInteger(position.realizedGainMinor, 'Realized gain');
  toSafeInteger(position.dividendsMinor, 'Dividends');
  toSafeInteger(position.otherFeesMinor, 'Fees');
  toSafeInteger(position.investedMinor, 'Amount invested');
  toSafeInteger(position.proceedsMinor, 'Sale proceeds');
  return position;
}

function grossOf(trade: { quantityMinor: number | null; unitPriceMinor: number | null }): bigint {
  if (trade.quantityMinor === null || trade.unitPriceMinor === null) {
    throw new ValidationError('A buy or sell needs a quantity and a unit price.');
  }
  const gross = valueAtPrice(BigInt(trade.quantityMinor), BigInt(trade.unitPriceMinor));
  if (gross <= BigInt(0)) {
    throw new ValidationError('This quantity at this price is worth less than one minor unit.');
  }
  return gross;
}

function requireAmount(amountMinor: number | null): number {
  if (amountMinor === null) throw new ValidationError('A dividend or fee needs an amount.');
  return amountMinor;
}

function requireActiveAsset(id: number): InvestmentAsset {
  const asset = getAsset(id);
  if (asset.isArchived) throw new ValidationError('Choose an active asset.');
  return asset;
}

/** An active account in the asset's own currency. Nothing converts. */
function requireTradeAccount(asset: InvestmentAsset, accountId: number) {
  const account = getAccountById(accountId);
  if (account === null) throw new NotFoundError(`Account ${accountId} was not found.`);
  if (account.isArchived) throw new ValidationError('Choose an active account.');
  if (account.currency !== asset.currency) {
    throw new ValidationError(
      `Choose an account in ${asset.currency}. Investments are not converted between currencies.`,
    );
  }
  return account;
}

function requireInvestmentReturnCategory(): number {
  const category = repository.getCategoryBySystemKey(INVESTMENT_RETURN_CATEGORY_KEY);
  if (category === null || category.type !== 'income') {
    throw new ValidationError('The Investment Return income category is missing.');
  }
  return category.id;
}

function assetNotFound(id: number): never {
  throw new NotFoundError(`Investment asset ${id} was not found.`);
}

function tradeNotFound(id: number): never {
  throw new NotFoundError(`Investment trade ${id} was not found.`);
}

function priceNotFound(id: number): never {
  throw new NotFoundError(`Investment price ${id} was not found.`);
}
