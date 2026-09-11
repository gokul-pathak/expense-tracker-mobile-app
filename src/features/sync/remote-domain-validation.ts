import type { TransactionType } from '@/db/constants';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';

import type {
  PulledBudgetRow,
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

/** Types the cloud schema permits but this app has no domain support for. */
export const UNSUPPORTED_TRANSACTION_TYPES: readonly string[] = ['investment', 'investment_return'];

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

  // A deleted record is invisible to every domain calculation, so its shape
  // cannot corrupt anything and is not re-litigated here.
  if (remoteDeleted) return undefined;

  if (occurrence !== null && !index.recurringOccurrences.has(occurrence)) {
    return { code: 'unknown_parent', detail: 'recurring_occurrence' };
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
