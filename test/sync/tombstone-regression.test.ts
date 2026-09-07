import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as accountService from '@/features/accounts/account.service';
import * as dashboardService from '@/features/dashboard/dashboard.service';
import * as personService from '@/features/people/person.service';
import * as reportsService from '@/features/reports/reports.service';
import { getPendingSyncMutation } from '@/features/sync/sync.repository';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';
import { filterTransactionViews } from '@/features/transactions/transaction-list-filter';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  expenseCategory,
  incomeCategory,
  makeAccount,
  makePerson,
  setupDatabase,
} from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

const transactionDate = new Date(2026, 0, 15);
const range = { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) };

describe('tombstoned records behave exactly like deleted records', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('removes a deleted expense from lists, detail, search, and balances', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const kept = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1000,
      title: 'Kept lunch',
      paymentMode: 'cash',
      transactionDate,
    });
    const removed = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 4000,
      title: 'Removed dinner',
      paymentMode: 'cash',
      transactionDate,
    });

    transactionService.deleteTransaction(removed.id);

    expect(transactionService.listTransactions().map((item) => item.id)).toEqual([kept.id]);
    expect(transactionService.listTransactionViews().map((item) => item.id)).toEqual([kept.id]);
    expect(() => transactionService.getTransaction(removed.id)).toThrow(/not found/i);
    expect(() => transactionService.getTransactionView(removed.id)).toThrow(/not found/i);
    expect(
      filterTransactionViews(transactionService.listTransactionViews(), {
        search: 'dinner',
        type: 'all',
        date: 'all',
      }),
    ).toHaveLength(0);
    expect(getAccountBalance(cash.id)).toBe(100000 - 1000);
    expect(getTotalBalance()).toBe(100000 - 1000);
  });

  it('removes a deleted transaction from the dashboard summary', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    transactionService.createIncome({
      accountId: cash.id,
      categoryId: incomeCategory().id,
      amountMinor: 60000,
      title: 'Salary',
      paymentMode: 'bank_transfer',
      transactionDate,
    });
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 20000,
      title: 'Rent',
      paymentMode: 'cash',
      transactionDate,
    });

    const before = dashboardService.getDashboardSummary({ now: transactionDate });
    expect(before.monthlyExpenseMinor).toBe(20000);
    expect(before.categorySpending).toHaveLength(1);

    transactionService.deleteTransaction(expense.id);

    const after = dashboardService.getDashboardSummary({ now: transactionDate });
    expect(after.monthlyExpenseMinor).toBe(0);
    expect(after.monthlyIncomeMinor).toBe(60000);
    expect(after.monthlySavingsMinor).toBe(60000);
    expect(after.totalBalanceMinor).toBe(100000 + 60000);
    expect(after.categorySpending).toEqual([]);
    expect(after.recentTransactions.map((item) => item.id)).not.toContain(expense.id);
    expect(dashboardService.getExpenseByCategory(range)).toEqual([]);
  });

  it('removes a deleted transaction from every report aggregate', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 7000,
      title: 'Groceries',
      paymentMode: 'cash',
      transactionDate,
    });

    expect(reportsService.getReportSummary(range).expenseMinor).toBe(7000);

    transactionService.deleteTransaction(expense.id);

    expect(reportsService.getReportSummary(range)).toMatchObject({
      incomeMinor: 0,
      expenseMinor: 0,
      savingsMinor: 0,
    });
    expect(reportsService.getExpenseCategoryBreakdown(range)).toEqual([]);
    expect(
      reportsService
        .getIncomeExpenseTrend(range, 'day')
        .reduce((total, point) => total + point.expenseMinor, 0),
    ).toBe(0);
  });

  it('removes a deleted debt transaction from receivables, liabilities, and history', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const person = makePerson('Ram');
    const lend = transactionService.createLend({
      personId: person.id,
      accountId: cash.id,
      amountMinor: 30000,
      transactionDate,
    });

    expect(transactionService.getPersonFinancialSummary(person.id).receivableMinor).toBe(30000);

    transactionService.deleteTransaction(lend.id);

    expect(transactionService.getPersonFinancialSummary(person.id)).toMatchObject({
      receivableMinor: 0,
      liabilityMinor: 0,
      status: 'settled',
    });
    expect(transactionService.getPeopleFinancialSummary().totalReceivableMinor).toBe(0);
    expect(transactionService.getPersonTransactionHistory(person.id)).toEqual([]);
    expect(getAccountBalance(cash.id)).toBe(100000);
  });

  it('lets a repayment be re-entered after its lending record is deleted', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const person = makePerson('Ram');
    const lend = transactionService.createLend({
      personId: person.id,
      accountId: cash.id,
      amountMinor: 30000,
      transactionDate,
    });
    transactionService.createRepaymentReceived({
      personId: person.id,
      accountId: cash.id,
      amountMinor: 10000,
      transactionDate,
    });

    // A tombstoned lend must stop supporting its repayments, exactly as a hard delete did.
    expect(() => transactionService.deleteTransaction(lend.id)).toThrow(/cannot exceed/i);
  });

  it('treats archiving an account as an update, not a deletion', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate,
    });

    accountService.archiveAccount(cash.id);

    expect(getPendingSyncMutation('account', cash.syncId!)).toMatchObject({ operation: 'upsert' });
    const archived = accountService.getAccount(cash.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.deletedAt).toBeNull();
    // Archived history still contributes to that account's own balance.
    expect(getAccountBalance(cash.id)).toBe(100000 - 5000);
    expect(transactionService.listTransactions()).toHaveLength(1);
  });

  it('treats archiving a person as an update, not a deletion', () => {
    const person = makePerson('Ram');
    personService.archivePerson(person.id);

    expect(getPendingSyncMutation('person', person.syncId!)).toMatchObject({ operation: 'upsert' });
    const archived = personService.getPerson(person.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.deletedAt).toBeNull();
    expect(personService.listArchivedPeople().map((item) => item.id)).toEqual([person.id]);
  });
});
