import { alias } from 'drizzle-orm/sqlite-core';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { TransactionType } from '@/db/constants';
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
      and(eq(transactions.personId, people.id), inArray(transactions.type, debtTypes)),
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
    .where(and(eq(transactions.personId, personId), inArray(transactions.type, debtTypes)))
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
