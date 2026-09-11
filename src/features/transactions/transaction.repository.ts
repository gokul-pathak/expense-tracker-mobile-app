import { alias } from 'drizzle-orm/sqlite-core';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import type { SyncWriter } from '@/features/sync/sync.types';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { people } from '@/db/schema/people';
import { transactions } from '@/db/schema/transactions';

import type {
  CreateTransactionRecord,
  PersonTransactionItem,
  TransactionView,
  UpdateTransactionRecord,
} from './transaction.types';

const transactionOrder = [
  desc(transactions.transactionDate),
  desc(transactions.createdAt),
  desc(transactions.id),
] as const;

const sourceAccount = alias(accounts, 'source_account');
const destinationAccount = alias(accounts, 'destination_account');
const debtTypes = ['lend', 'borrow', 'repayment_received', 'repayment_paid'] as const;
// Tombstoned rows stay in SQLite for future sync but must behave as deleted everywhere.
const notDeleted = isNull(transactions.deletedAt);

export function getTransactions() {
  return db
    .select()
    .from(transactions)
    .where(notDeleted)
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionById(id: number) {
  return (
    db
      .select()
      .from(transactions)
      .where(and(notDeleted, eq(transactions.id, id)))
      .get() ?? null
  );
}

export function getTransactionViews() {
  return getTransactionViewQuery()
    .orderBy(...transactionOrder)
    .limit(500)
    .all()
    .map(toView);
}

export function getRecentTransactionViews(limit: number) {
  return getTransactionViewQuery()
    .orderBy(...transactionOrder)
    .limit(limit)
    .all()
    .map(toView);
}

export function getTransactionViewById(id: number) {
  const result = getTransactionViewQuery(id).get();
  return result ? toView(result) : null;
}

export function getTransactionsByAccount(accountId: number) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        notDeleted,
        or(
          eq(transactions.sourceAccountId, accountId),
          eq(transactions.destinationAccountId, accountId),
        ),
      ),
    )
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionsByCategory(categoryId: number) {
  return db
    .select()
    .from(transactions)
    .where(and(notDeleted, eq(transactions.categoryId, categoryId)))
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionsByType(type: TransactionType) {
  return db
    .select()
    .from(transactions)
    .where(and(notDeleted, eq(transactions.type, type)))
    .orderBy(...transactionOrder)
    .all();
}

export function createTransaction(data: CreateTransactionRecord) {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const transaction = tx
      .insert(transactions)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'transaction',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return transaction;
  });
}

/**
 * Writes the transaction a recurring occurrence produces, inside the caller's
 * SQLite transaction.
 *
 * Two things make this different from `createTransaction`, and both are why it
 * takes a writer rather than opening its own transaction:
 *
 * - The identity is supplied, not created. It is derived from the occurrence, so
 *   two devices generating the same date offline write the same identity and the
 *   cloud keeps one transaction. Nothing a person can reach passes an identity
 *   here — the UI data boundary does not export it, and only the recurring
 *   repository calls it.
 * - It must commit or roll back with the occurrence that records it. A handled
 *   occurrence with no transaction, or a transaction no occurrence accounts for,
 *   is exactly the half-state that would let a date be generated twice.
 *
 * A row with this identity can already exist in two ways. A live one is a
 * transaction for this very occurrence — possibly edited since by the user — and
 * is kept exactly as it is. A tombstone means the occurrence was retired with it
 * by a cloud replacement of the dataset, and generating the date again revives it
 * under the same identity rather than inventing a second one.
 */
export function writeGeneratedTransaction(
  writer: SyncWriter,
  data: CreateTransactionRecord & { recurringOccurrenceId: number },
  syncId: string,
): { transaction: typeof transactions.$inferSelect; written: boolean } {
  const existing = writer.select().from(transactions).where(eq(transactions.syncId, syncId)).get();

  if (existing !== undefined && existing.deletedAt === null) {
    if (existing.recurringOccurrenceId !== data.recurringOccurrenceId) {
      throw new Error('A generated transaction identity belongs to a different occurrence.');
    }
    return { transaction: existing, written: false };
  }

  const transaction =
    existing === undefined
      ? writer
          .insert(transactions)
          .values({ ...data, syncId })
          .returning()
          .get()
      : writer
          .update(transactions)
          .set({ ...data, deletedAt: null })
          .where(eq(transactions.id, existing.id))
          .returning()
          .get();
  enqueueSyncMutation(writer, {
    entityType: 'transaction',
    entitySyncId: syncId,
    operation: 'upsert',
  });
  return { transaction, written: true };
}

export function updateTransaction(id: number, data: UpdateTransactionRecord) {
  return db.transaction((tx) => {
    const transaction =
      tx
        .update(transactions)
        .set(data)
        .where(and(notDeleted, eq(transactions.id, id)))
        .returning()
        .get() ?? null;
    if (transaction === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'transaction',
      entitySyncId: requireSyncId(transaction.syncId, 'transaction'),
      operation: 'upsert',
    });
    return transaction;
  });
}

/**
 * Deletion is a tombstone: the row keeps its global identity so the deletion
 * can reach other devices later, and every domain query hides it immediately.
 */
export function deleteTransaction(id: number, deletedAt = new Date()) {
  return db.transaction((tx) => {
    const transaction =
      tx
        .update(transactions)
        .set({ deletedAt })
        .where(and(notDeleted, eq(transactions.id, id)))
        .returning()
        .get() ?? null;
    if (transaction === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'transaction',
      entitySyncId: requireSyncId(transaction.syncId, 'transaction'),
      operation: 'delete',
    });
    return transaction;
  });
}

export function getAccountIncomeTotal(accountId: number) {
  return getAccountTotal('income', transactions.destinationAccountId, accountId);
}

export function getAccountExpenseTotal(accountId: number) {
  return getAccountTotal('expense', transactions.sourceAccountId, accountId);
}

export function getAccountTransferReceivedTotal(accountId: number) {
  return getAccountTotal('transfer', transactions.destinationAccountId, accountId);
}

export function getAccountTransferSentTotal(accountId: number) {
  return getAccountTotal('transfer', transactions.sourceAccountId, accountId);
}

export function getIncomeTotal() {
  return getTransactionTotal('income');
}

export function getExpenseTotal() {
  return getTransactionTotal('expense');
}

export function getAccountLendTotal(accountId: number) {
  return getAccountTotal('lend', transactions.sourceAccountId, accountId);
}

export function getAccountBorrowTotal(accountId: number) {
  return getAccountTotal('borrow', transactions.destinationAccountId, accountId);
}

export function getAccountRepaymentReceivedTotal(accountId: number) {
  return getAccountTotal('repayment_received', transactions.destinationAccountId, accountId);
}

export function getAccountRepaymentPaidTotal(accountId: number) {
  return getAccountTotal('repayment_paid', transactions.sourceAccountId, accountId);
}

export function getLendTotal() {
  return getTransactionTotal('lend');
}

export function getBorrowTotal() {
  return getTransactionTotal('borrow');
}

export function getRepaymentReceivedTotal() {
  return getTransactionTotal('repayment_received');
}

export function getRepaymentPaidTotal() {
  return getTransactionTotal('repayment_paid');
}

export function getPersonDebtTotals(personId: number, excludeTransactionId?: number) {
  const result = db
    .select({
      lentMinor: conditionalTotal('lend'),
      borrowedMinor: conditionalTotal('borrow'),
      repaymentsReceivedMinor: conditionalTotal('repayment_received'),
      repaymentsPaidMinor: conditionalTotal('repayment_paid'),
    })
    .from(transactions)
    .where(
      and(
        notDeleted,
        eq(transactions.personId, personId),
        inArray(transactions.type, debtTypes),
        excludeTransactionId === undefined ? undefined : ne(transactions.id, excludeTransactionId),
      ),
    )
    .get();

  return {
    lentMinor: result?.lentMinor ?? 0,
    borrowedMinor: result?.borrowedMinor ?? 0,
    repaymentsReceivedMinor: result?.repaymentsReceivedMinor ?? 0,
    repaymentsPaidMinor: result?.repaymentsPaidMinor ?? 0,
  };
}

export function getPersonDebtCurrencies(personId: number, excludeTransactionId?: number) {
  return db
    .selectDistinct({ currency: transactions.currency })
    .from(transactions)
    .where(
      and(
        notDeleted,
        eq(transactions.personId, personId),
        inArray(transactions.type, debtTypes),
        excludeTransactionId === undefined ? undefined : ne(transactions.id, excludeTransactionId),
      ),
    )
    .all()
    .map((result) => result.currency);
}

export function getPeopleDebtTotals() {
  return db
    .select({
      personId: people.id,
      lentMinor: conditionalTotal('lend'),
      borrowedMinor: conditionalTotal('borrow'),
      repaymentsReceivedMinor: conditionalTotal('repayment_received'),
      repaymentsPaidMinor: conditionalTotal('repayment_paid'),
    })
    .from(people)
    .leftJoin(
      transactions,
      and(notDeleted, eq(transactions.personId, people.id), inArray(transactions.type, debtTypes)),
    )
    .groupBy(people.id)
    .all();
}

export function getPersonTransactionItems(personId: number): PersonTransactionItem[] {
  const account = alias(accounts, 'person_transaction_account');
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      accountId: account.id,
      accountName: account.name,
      accountIcon: account.icon,
      transactionDate: transactions.transactionDate,
      note: transactions.note,
    })
    .from(transactions)
    .innerJoin(
      account,
      or(
        eq(transactions.sourceAccountId, account.id),
        eq(transactions.destinationAccountId, account.id),
      ),
    )
    .where(
      and(notDeleted, eq(transactions.personId, personId), inArray(transactions.type, debtTypes)),
    )
    .orderBy(...transactionOrder)
    .all() as PersonTransactionItem[];
}

function getAccountTotal(
  type: TransactionType,
  accountColumn: typeof transactions.sourceAccountId,
  accountId: number,
) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(notDeleted, eq(transactions.type, type), eq(accountColumn, accountId)))
    .get();

  return result?.total ?? 0;
}

function getTransactionTotal(type: TransactionType) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(notDeleted, eq(transactions.type, type)))
    .get();

  return result?.total ?? 0;
}

function conditionalTotal(type: (typeof debtTypes)[number]) {
  return sql<number>`coalesce(sum(case when ${transactions.type} = ${type} then ${transactions.amountMinor} else 0 end), 0)`;
}

function getTransactionViewQuery(id?: number) {
  return db
    .select({
      transaction: transactions,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      personName: people.name,
      sourceAccountId: sourceAccount.id,
      sourceAccountName: sourceAccount.name,
      sourceAccountIcon: sourceAccount.icon,
      sourceAccountType: sourceAccount.type,
      destinationAccountId: destinationAccount.id,
      destinationAccountName: destinationAccount.name,
      destinationAccountIcon: destinationAccount.icon,
      destinationAccountType: destinationAccount.type,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(people, eq(transactions.personId, people.id))
    .leftJoin(sourceAccount, eq(transactions.sourceAccountId, sourceAccount.id))
    .leftJoin(destinationAccount, eq(transactions.destinationAccountId, destinationAccount.id))
    .where(
      and(
        notDeleted,
        inArray(transactions.type, [
          'expense',
          'income',
          'transfer',
          'lend',
          'borrow',
          'repayment_received',
          'repayment_paid',
        ]),
        id ? eq(transactions.id, id) : undefined,
      ),
    );
}

function toView(
  result: ReturnType<typeof getTransactionViewQuery>['_']['result'][number],
): TransactionView {
  const account =
    result.transaction.type === 'expense' ||
    result.transaction.type === 'lend' ||
    result.transaction.type === 'repayment_paid' ||
    result.transaction.type === 'transfer'
      ? {
          id: result.sourceAccountId,
          name: result.sourceAccountName,
          icon: result.sourceAccountIcon,
          type: result.sourceAccountType,
        }
      : {
          id: result.destinationAccountId,
          name: result.destinationAccountName,
          icon: result.destinationAccountIcon,
          type: result.destinationAccountType,
        };
  return {
    ...result.transaction,
    categoryName: result.categoryName,
    categoryIcon: result.categoryIcon,
    personName: result.personName,
    accountId: account.id,
    accountName: account.name,
    accountIcon: account.icon,
    accountType: account.type,
    sourceAccountName: result.sourceAccountName,
    destinationAccountName: result.destinationAccountName,
  };
}
