import { and, desc, eq, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
import { transactions } from '@/db/schema/transactions';

import type { CreateTransactionRecord, UpdateTransactionRecord } from './transaction.types';

const transactionOrder = [
  desc(transactions.transactionDate),
  desc(transactions.createdAt),
  desc(transactions.id),
] as const;

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
