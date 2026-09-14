import type { TransactionType } from '@/db/constants';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';

import { valueAtPrice } from '@/features/investments/investment-math';
import { replayTrades, type ReplayTrade } from '@/features/investments/investment-replay';

import type {
  PulledBudgetRow,
  PulledInvestmentPriceRow,
  PulledInvestmentTradeRow,
  PulledRecurringOccurrenceRow,
  PulledRecurringTemplateRow,
  PulledTransactionRow,
} from './remote/remote-pull-rows';

/**
 * The domain rules a downloaded transaction must satisfy before it is allowed
 * to touch SQLite.
 *
 * The cloud enforces shape, but meaning cannot be delegated: whether a category
 * may carry an expense, whether two transfer accounts differ, whether a currency
 * agrees with its account, and whether a repayment is covered by its principal
 * are all questions the local domain answers, so the client answers them again.
 *
 * Shared by incremental pull and by whole-dataset restore, so a record cannot be
 * accepted through one path that the other would reject.
 */

/**
 * Types the cloud schema permits but this app has no domain support for.
 *
 * Empty since M10A: `investment` and `investment_return` are the cash side of an
 * investment trade, and are accepted only together with the trade they belong to.
 */
export const UNSUPPORTED_TRANSACTION_TYPES: readonly string[] = [];

export const DEBT_TYPES = ['lend', 'borrow', 'repayment_received', 'repayment_paid'] as const;

export type DebtType = (typeof DEBT_TYPES)[number];

export function isDebtType(type: TransactionType | string): type is DebtType {
  return DEBT_TYPES.includes(type as DebtType);
}

/** Relations a transaction may reference, from local rows and the batch alike. */
export type RemoteRelationIndex = {
  accounts: Map<string, { currency: string; isArchived: boolean }>;
  categoryTypes: Map<string, string>;
  people: Set<string>;
  /**
   * Templates and occurrences known locally or arriving in the batch, deleted
   * ones included. A deleted template's occurrences and the transactions they
   * produced are still real records, and they still need their parent to exist.
   */
  recurringTemplates: Set<string>;
  recurringOccurrences: Set<string>;
  /** Assets known locally or arriving in the batch, deleted ones included. */
  investmentAssets: Map<string, { currency: string }>;
  /** Trades known locally or arriving in the batch, deleted ones included. */
  investmentTrades: Set<string>;
};

export type RemoteRecordProblem = {
  code: 'invalid_remote_data' | 'unknown_parent' | 'unsupported_remote_data';
  detail: string;
};

export type TransactionProblem = RemoteRecordProblem;

export function validateRemoteTransaction(
  row: PulledTransactionRow,
  index: RemoteRelationIndex,
  remoteDeleted: boolean,
): TransactionProblem | undefined {
  if (UNSUPPORTED_TRANSACTION_TYPES.includes(row.type)) {
    return { code: 'unsupported_remote_data', detail: `type:${row.type}` };
  }

  // A generated transaction's identity is derived from its occurrence. One that
  // claims an occurrence under any other identity is a second transaction for a
  // date that already has one, which is the duplication recurring identity
  // exists to make impossible.
  const occurrence = row.recurring_occurrence_sync_id;
  if (occurrence !== null) {
    if (row.type !== 'expense' && row.type !== 'income') {
      return { code: 'invalid_remote_data', detail: 'recurring_type' };
    }
    if (row.sync_id !== deriveGeneratedTransactionSyncId(occurrence)) {
      return { code: 'invalid_remote_data', detail: 'recurring_transaction_identity' };
    }
  }

  // Investment cash belongs to exactly one trade, and a trade's cash is one of
  // three types. `investment` cash with no trade is money moving for no recorded
  // reason, and a trade link on any other type is cash the trade cannot explain.
  const trade = row.investment_trade_sync_id;
  if ((row.type === 'investment' || row.type === 'investment_return') && trade === null) {
    return { code: 'invalid_remote_data', detail: 'investment_without_trade' };
  }
  if (trade !== null) {
    if (row.type !== 'investment' && row.type !== 'investment_return' && row.type !== 'income') {
      return { code: 'invalid_remote_data', detail: 'investment_cash_type' };
    }
    if (occurrence !== null) return { code: 'invalid_remote_data', detail: 'investment_recurring' };
  }

  // A deleted record is invisible to every domain calculation, so its shape
  // cannot corrupt anything and is not re-litigated here.
  if (remoteDeleted) return undefined;

  if (occurrence !== null && !index.recurringOccurrences.has(occurrence)) {
    return { code: 'unknown_parent', detail: 'recurring_occurrence' };
  }
  // Whether the cash still matches its trade's amount and account is not checked
  // here: an edit of both can arrive across two pages, and refusing the first
  // half would stall the download before the second could ever arrive.
  // `verifySyncIntegrity` reports a lasting mismatch instead.
  if (trade !== null && !index.investmentTrades.has(trade)) {
    return { code: 'unknown_parent', detail: 'investment_trade' };
  }

  const source = row.source_account_sync_id;
  const destination = row.destination_account_sync_id;
  const category = row.category_sync_id;
  const person = row.person_sync_id;

  const shape = validateShape(row.type, { source, destination, category, person });
  if (shape !== undefined) return shape;

  if (category !== null) {
    const type = index.categoryTypes.get(category);
    if (type === undefined) return { code: 'unknown_parent', detail: 'category' };
    const required = row.type === 'expense' ? 'expense' : 'income';
    if (type !== required) return { code: 'invalid_remote_data', detail: 'category_type' };
  }

  for (const accountSyncId of [source, destination]) {
    if (accountSyncId === null) continue;
    const account = index.accounts.get(accountSyncId);
    // A missing parent is never resolved by writing a null foreign key: that
    // would silently change what the record means.
    if (account === undefined) return { code: 'unknown_parent', detail: 'account' };
    if (account.currency !== row.currency) {
      return { code: 'invalid_remote_data', detail: 'account_currency' };
    }
  }

  if (person !== null && !index.people.has(person)) {
    return { code: 'unknown_parent', detail: 'person' };
  }

  return undefined;
}

function validateShape(
  type: PulledTransactionRow['type'],
  relations: {
    source: string | null;
    destination: string | null;
    category: string | null;
    person: string | null;
  },
): TransactionProblem | undefined {
  const { source, destination, category, person } = relations;
  const invalid = (detail: string): TransactionProblem => ({ code: 'invalid_remote_data', detail });

  switch (type) {
    case 'expense':
      if (source === null || destination !== null) return invalid('expense_accounts');
      if (category === null || person !== null) return invalid('expense_relations');
      return undefined;
    case 'income':
      if (destination === null || source !== null) return invalid('income_accounts');
      if (category === null || person !== null) return invalid('income_relations');
      return undefined;
    case 'transfer':
      if (source === null || destination === null) return invalid('transfer_accounts');
      if (source === destination) return invalid('transfer_same_account');
      if (category !== null || person !== null) return invalid('transfer_relations');
      return undefined;
    case 'lend':
    case 'repayment_paid':
      if (source === null || destination !== null) return invalid('debt_accounts');
      if (person === null || category !== null) return invalid('debt_relations');
      return undefined;
    case 'borrow':
    case 'repayment_received':
      if (destination === null || source !== null) return invalid('debt_accounts');
      if (person === null || category !== null) return invalid('debt_relations');
      return undefined;
    // Cash out to an investment, and cash back from one. Never a category or a person.
    case 'investment':
      if (source === null || destination !== null) return invalid('investment_accounts');
      if (category !== null || person !== null) return invalid('investment_relations');
      return undefined;
    case 'investment_return':
      if (destination === null || source !== null) return invalid('investment_accounts');
      if (category !== null || person !== null) return invalid('investment_relations');
      return undefined;
    default:
      return { code: 'unsupported_remote_data', detail: `type:${type}` };
  }
}

/**
 * The domain rules a downloaded budget must satisfy.
 *
 * A budget is a plan, so there is little to check beyond what it points at — and
 * that check matters: a budget whose category is missing locally must not be
 * written with a null category, because null already means something else
 * entirely, the overall monthly budget. Refusing it leaves the record for a
 * later run, once its parent has arrived.
 */
export function validateRemoteBudget(
  row: PulledBudgetRow,
  index: RemoteRelationIndex,
  remoteDeleted: boolean,
): RemoteRecordProblem | undefined {
  // A deleted plan is invisible to every calculation, so its shape cannot
  // corrupt anything and is not re-litigated here.
  if (remoteDeleted) return undefined;
  if (row.category_sync_id === null) return undefined;

  const type = index.categoryTypes.get(row.category_sync_id);
  if (type === undefined) return { code: 'unknown_parent', detail: 'category' };
  // A budget is a spending limit, so an income category has nothing to limit.
  if (type !== 'expense') return { code: 'invalid_remote_data', detail: 'category_type' };
  return undefined;
}

/**
 * The rules a downloaded recurring template must satisfy.
 *
 * Its parents must exist whether or not it is deleted: a deleted template is
 * still written locally, because its occurrences and their transactions still
 * point at it. The meaning checks — a category of the template's type, an
 * account in the template's currency — apply only to a live one, since a
 * deleted template schedules nothing.
 */
export function validateRemoteRecurringTemplate(
  row: PulledRecurringTemplateRow,
  index: RemoteRelationIndex,
  remoteDeleted: boolean,
): RemoteRecordProblem | undefined {
  const categoryType = index.categoryTypes.get(row.category_sync_id);
  if (categoryType === undefined) return { code: 'unknown_parent', detail: 'category' };
  const account = index.accounts.get(row.account_sync_id);
  if (account === undefined) return { code: 'unknown_parent', detail: 'account' };
  if (remoteDeleted) return undefined;

  if (row.end_date !== null && row.end_date < row.start_date) {
    return { code: 'invalid_remote_data', detail: 'end_before_start' };
  }
  if (categoryType !== row.type) return { code: 'invalid_remote_data', detail: 'category_type' };
  if (account.currency !== row.currency) {
    return { code: 'invalid_remote_data', detail: 'account_currency' };
  }
  return undefined;
}

/**
 * The rules a downloaded occurrence must satisfy.
 *
 * Its identity must be the one derived from its template and date. That is the
 * guarantee two devices handling the same date converge on one record, and an
 * occurrence carrying any other identity would let a second record of the same
 * date exist.
 *
 * Whether the date is still on the template's schedule is deliberately not
 * checked. A template can be rescheduled on one device while another, offline,
 * handles a date from the old schedule; refusing that record would stall the
 * download behind it forever. An off-schedule decision is harmless — the due
 * engine only walks the schedule's own dates — so it is kept.
 */
export function validateRemoteRecurringOccurrence(
  row: PulledRecurringOccurrenceRow,
  index: RemoteRelationIndex,
): RemoteRecordProblem | undefined {
  if (row.sync_id !== deriveOccurrenceSyncId(row.template_sync_id, row.occurrence_date)) {
    return { code: 'invalid_remote_data', detail: 'occurrence_identity' };
  }
  if (!index.recurringTemplates.has(row.template_sync_id)) {
    return { code: 'unknown_parent', detail: 'recurring_template' };
  }
  return undefined;
}

/** One generated transaction per occurrence, across a whole dataset. */
export function findDuplicateGeneratedTransaction<TKey>(
  rows: readonly { key: TKey; recurringOccurrenceSyncId: string | null }[],
): TKey | undefined {
  const claimed = new Set<string>();
  for (const row of rows) {
    if (row.recurringOccurrenceSyncId === null) continue;
    if (claimed.has(row.recurringOccurrenceSyncId)) return row.key;
    claimed.add(row.recurringOccurrenceSyncId);
  }
  return undefined;
}

/**
 * Two live budgets for the same month, currency and category have no meaningful
 * reading: neither is the plan, and their sum is a number nobody chose. The
 * cloud refuses the pair with a partial unique index; this is the same rule for
 * a whole dataset that is about to replace a device's own.
 */
export function findDuplicateBudget<TKey>(
  budgets: readonly {
    key: TKey;
    categorySyncId: string | null;
    periodMonth: string;
    currency: string;
  }[],
): TKey | undefined {
  const seen = new Set<string>();
  for (const budget of budgets) {
    const identity = `${budget.periodMonth}|${budget.currency}|${budget.categorySyncId ?? ''}`;
    if (seen.has(identity)) return budget.key;
    seen.add(identity);
  }
  return undefined;
}

/** One debt record's effect on a person's balance. */
export type DebtContribution<TKey> = {
  key: TKey;
  personSyncId: string;
  type: DebtType;
  amountMinor: number;
  currency: string;
};

export type DebtViolation<TKey> = { key: TKey; problem: string };

/**
 * Debt invariants across existing history and incoming records together.
 *
 * `incoming` must already be in the order the records will be applied, so a
 * principal is counted before the repayment that depends on it — a repayment
 * arriving alongside its principal is valid, and blame for a real violation
 * lands on the record that caused it rather than on the first one seen.
 */
export function findDebtViolation<TKey>(
  existing: readonly Omit<DebtContribution<TKey>, 'key'>[],
  incoming: readonly DebtContribution<TKey>[],
): DebtViolation<TKey> | undefined {
  type Totals = Record<DebtType, number>;
  const empty = (): Totals => ({ lend: 0, borrow: 0, repayment_received: 0, repayment_paid: 0 });
  const totals = new Map<string, Totals>();
  const currencies = new Map<string, Set<string>>();

  const contribute = (personSyncId: string, type: DebtType, amount: number, currency: string) => {
    const bucket = totals.get(personSyncId) ?? empty();
    bucket[type] += amount;
    totals.set(personSyncId, bucket);
    const seen = currencies.get(personSyncId) ?? new Set<string>();
    seen.add(currency);
    currencies.set(personSyncId, seen);
  };

  for (const row of existing) {
    contribute(row.personSyncId, row.type, row.amountMinor, row.currency);
  }

  for (const row of incoming) {
    contribute(row.personSyncId, row.type, row.amountMinor, row.currency);
    const bucket = totals.get(row.personSyncId)!;
    const problem =
      bucket.repayment_received > bucket.lend
        ? 'repayment_received_exceeds_lent'
        : bucket.repayment_paid > bucket.borrow
          ? 'repayment_paid_exceeds_borrowed'
          : (currencies.get(row.personSyncId)?.size ?? 0) > 1
            ? 'mixed_person_currency'
            : undefined;
    if (problem !== undefined) return { key: row.key, problem };
  }

  return undefined;
}

/**
 * The rules a downloaded price must satisfy: its asset exists, and a live price
 * is in the asset's own currency. A deleted price hides nothing, so it is not
 * checked.
 */
export function validateRemoteInvestmentPrice(
  row: PulledInvestmentPriceRow,
  index: RemoteRelationIndex,
  remoteDeleted: boolean,
): RemoteRecordProblem | undefined {
  if (remoteDeleted) return undefined;
  const asset = index.investmentAssets.get(row.asset_sync_id);
  if (asset === undefined) return { code: 'unknown_parent', detail: 'investment_asset' };
  if (asset.currency !== row.currency) {
    return { code: 'invalid_remote_data', detail: 'asset_currency' };
  }
  return undefined;
}

/**
 * The rules a downloaded trade must satisfy on its own.
 *
 * Its asset and account exist and share its currency — nothing converts — it
 * carries exactly the figures its type needs, and the cash it implies is a
 * positive amount that fits. Whether it fits the asset's history is a question
 * about the whole batch, answered by `findInvestmentHoldingViolation`.
 */
export function validateRemoteInvestmentTrade(
  row: PulledInvestmentTradeRow,
  index: RemoteRelationIndex,
  remoteDeleted: boolean,
): RemoteRecordProblem | undefined {
  if (remoteDeleted) return undefined;
  const asset = index.investmentAssets.get(row.asset_sync_id);
  if (asset === undefined) return { code: 'unknown_parent', detail: 'investment_asset' };
  const account = index.accounts.get(row.account_sync_id);
  if (account === undefined) return { code: 'unknown_parent', detail: 'account' };
  if (asset.currency !== row.currency) {
    return { code: 'invalid_remote_data', detail: 'asset_currency' };
  }
  if (account.currency !== row.currency) {
    return { code: 'invalid_remote_data', detail: 'account_currency' };
  }

  const invalid = (detail: string): RemoteRecordProblem => ({
    code: 'invalid_remote_data',
    detail,
  });
  const zero = BigInt(0);
  if (row.trade_type === 'buy' || row.trade_type === 'sell') {
    if (row.quantity_minor === null || row.unit_price_minor === null || row.amount_minor !== null) {
      return invalid('trade_shape');
    }
    const gross = valueAtPrice(BigInt(row.quantity_minor), BigInt(row.unit_price_minor));
    const fee = BigInt(row.fee_minor);
    const cash = row.trade_type === 'buy' ? gross + fee : gross - fee;
    if (gross <= zero || cash <= zero || cash > BigInt(Number.MAX_SAFE_INTEGER)) {
      return invalid('trade_cash');
    }
    return undefined;
  }
  if (
    row.quantity_minor !== null ||
    row.unit_price_minor !== null ||
    row.fee_minor !== 0 ||
    row.amount_minor === null
  ) {
    return invalid('trade_shape');
  }
  return undefined;
}

/** One trade's state, keyed to the asset whose history it belongs to. */
export type InvestmentTradeState = ReplayTrade & { assetSyncId: string };

/** One incoming change to a trade: its new state, or null when it is removed. */
export type InvestmentTradeChange<TKey> = {
  key: TKey;
  syncId: string;
  assetSyncId: string;
  trade: InvestmentTradeState | null;
};

/**
 * Whether applying incoming trade changes, in the order given, ever turns a
 * history that could have happened into one that sells more than it holds.
 *
 * `existing` is the local live history, trades not yet uploaded included — which
 * is exactly how two devices each selling 7 of the same 10 shares is caught. The
 * change to blame is the first one after which a valid history becomes invalid.
 * An asset whose history was already invalid before the batch is not blamed on
 * it: refusing the download would not repair it.
 */
export function findInvestmentHoldingViolation<TKey>(
  existing: readonly InvestmentTradeState[],
  incoming: readonly InvestmentTradeChange<TKey>[],
): { key: TKey; problem: string } | undefined {
  const byAsset = new Map<string, Map<string, ReplayTrade>>();
  for (const trade of existing) {
    const trades = byAsset.get(trade.assetSyncId) ?? new Map<string, ReplayTrade>();
    trades.set(trade.syncId, trade);
    byAsset.set(trade.assetSyncId, trades);
  }
  const apply = (trades: Map<string, ReplayTrade>, change: InvestmentTradeChange<TKey>) => {
    if (change.trade === null) trades.delete(change.syncId);
    else trades.set(change.syncId, change.trade);
  };
  const valid = (trades: Map<string, ReplayTrade>) => replayTrades([...trades.values()]).ok;

  // Everything at once first. That is almost always valid, and then it is the
  // only replay needed.
  const touched = [...new Set(incoming.map((change) => change.assetSyncId))];
  const finalState = new Map(
    touched.map((asset) => [asset, new Map(byAsset.get(asset) ?? new Map<string, ReplayTrade>())]),
  );
  for (const change of incoming) apply(finalState.get(change.assetSyncId)!, change);
  const failing = new Set(
    touched.filter(
      (asset) =>
        valid(byAsset.get(asset) ?? new Map<string, ReplayTrade>()) &&
        !valid(finalState.get(asset)!),
    ),
  );
  if (failing.size === 0) return undefined;

  const working = new Map(
    [...failing].map((asset) => [
      asset,
      new Map(byAsset.get(asset) ?? new Map<string, ReplayTrade>()),
    ]),
  );
  for (const change of incoming) {
    const trades = working.get(change.assetSyncId);
    if (trades === undefined) continue;
    apply(trades, change);
    if (!valid(trades)) return { key: change.key, problem: 'investment_oversold' };
  }
  // Unreachable: the last change for a failing asset leaves its final state.
  const first = incoming.find((change) => failing.has(change.assetSyncId))!;
  return { key: first.key, problem: 'investment_oversold' };
}
