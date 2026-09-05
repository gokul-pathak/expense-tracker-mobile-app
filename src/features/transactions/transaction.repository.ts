import { alias } from 'drizzle-orm/sqlite-core';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
import { accounts } from '@/db/schema/accounts';
import { categories } from '@/db/schema/categories';
import { transactions } from '@/db/schema/transactions';

import type {
  CreateTransactionRecord,
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

export function getTransactions() {
  return db
    .select()
    .from(transactions)
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionById(id: number) {
  return db.select().from(transactions).where(eq(transactions.id, id)).get() ?? null;
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
      or(
        eq(transactions.sourceAccountId, accountId),
        eq(transactions.destinationAccountId, accountId),
      ),
    )
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionsByCategory(categoryId: number) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.categoryId, categoryId))
    .orderBy(...transactionOrder)
    .all();
}

export function getTransactionsByType(type: TransactionType) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.type, type))
    .orderBy(...transactionOrder)
    .all();
}

export function createTransaction(data: CreateTransactionRecord) {
  return db.insert(transactions).values(data).returning().get();
}

export function updateTransaction(id: number, data: UpdateTransactionRecord) {
  return db.update(transactions).set(data).where(eq(transactions.id, id)).returning().get() ?? null;
}

export function deleteTransaction(id: number) {
  return db.delete(transactions).where(eq(transactions.id, id)).returning().get() ?? null;
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

function getAccountTotal(
  type: TransactionType,
  accountColumn: typeof transactions.sourceAccountId,
  accountId: number,
) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.type, type), eq(accountColumn, accountId)))
    .get();

  return result?.total ?? 0;
}

function getTransactionTotal(type: TransactionType) {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(eq(transactions.type, type))
    .get();

  return result?.total ?? 0;
}

function getTransactionViewQuery(id?: number) {
  return db
    .select({
      transaction: transactions,
      categoryName: categories.name,
      categoryIcon: categories.icon,
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
    .leftJoin(sourceAccount, eq(transactions.sourceAccountId, sourceAccount.id))
    .leftJoin(destinationAccount, eq(transactions.destinationAccountId, destinationAccount.id))
    .where(
      and(
        inArray(transactions.type, ['expense', 'income']),
        id ? eq(transactions.id, id) : undefined,
      ),
    );
}

function toView(
  result: ReturnType<typeof getTransactionViewQuery>['_']['result'][number],
): TransactionView {
  const account =
    result.transaction.type === 'expense'
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
    accountId: account.id,
    accountName: account.name,
    accountIcon: account.icon,
    accountType: account.type,
  };
}
