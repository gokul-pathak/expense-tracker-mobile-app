import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as portfolio from '@/features/investments/portfolio.service';
import * as recurring from '@/features/recurring/recurring.service';
import {
  getReportRange,
  getReportSummary,
  listReportCurrencies,
} from '@/features/reports/reports.service';
import { ValidationError } from '@/features/shared/errors';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import { groupTransactionsByDay } from '@/features/transactions/transaction-presentation';
import * as transactions from '@/features/transactions/transaction.service';

import { incomeCategory, makeAccount, makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

import { AS_OF_DATE, buildCanonical, MONTH, NOW, rupees, september } from './fixture';

/**
 * The release accounting audit: one deterministic fixture across every kind of
 * money movement, every figure checked, and every mutation checked for moving each
 * dependent figure exactly once.
 */

const dollars = rupees;
const septemberReport = () => getReportSummary(getReportRange('this_month', NOW));
const augustReport = () => getReportSummary(getReportRange('this_month', new Date(2026, 7, 20)));
const home = () => getDashboardSummary({ now: NOW });

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

/**
 * Each account's balance recomputed from the raw rows, independently of every
 * service: the opening balance, plus every live transaction that paid into it,
 * minus every live transaction that paid out of it.
 */
function balanceFromRows(accountId: number): number {
  const row = rawClient()
    .prepare(
      `SELECT a.opening_balance_minor
         + coalesce((SELECT sum(amount_minor) FROM transactions WHERE deleted_at IS NULL AND destination_account_id = a.id), 0)
         - coalesce((SELECT sum(amount_minor) FROM transactions WHERE deleted_at IS NULL AND source_account_id = a.id), 0) AS balance
       FROM accounts a WHERE a.id = ?`,
    )
    .get(accountId) as { balance: number };
  return Number(row.balance);
}

describe('full accounting audit', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('derives every balance and figure of the canonical fixture exactly', () => {
    const f = buildCanonical();

    expect(getAccountBalance(f.cash.id)).toBe(rupees(20_000));
    expect(getAccountBalance(f.bank.id)).toBe(rupees(158_150));
    expect(home()).toMatchObject({
      currency: 'NPR',
      accountCount: 2,
      totalBalanceMinor: rupees(178_150),
      monthlyIncomeMinor: rupees(65_500),
      monthlyExpenseMinor: rupees(5_000),
      monthlySavingsMinor: rupees(60_500),
      otherCurrencies: [],
    });
    expect(septemberReport()).toEqual({
      incomeMinor: rupees(65_500),
      expenseMinor: rupees(5_000),
      savingsMinor: rupees(60_500),
    });
    expect(transactions.getPersonFinancialSummary(f.ram.id)).toMatchObject({
      receivableMinor: rupees(5_000),
      liabilityMinor: 0,
    });
    expect(transactions.getPersonFinancialSummary(f.sita.id)).toMatchObject({
      receivableMinor: 0,
      liabilityMinor: rupees(8_000),
    });
    expect(portfolio.getHolding(f.asset.id, { asOf: NOW })).toMatchObject({
      quantityMinor: parseQuantity('6'),
      costBasisMinor: rupees(6_060),
      realizedGainMinor: rupees(710),
      dividendsMinor: rupees(500),
    });
  });

  it('recomputes every balance from the raw rows to the same figure, with nothing stored', () => {
    buildCanonical();
    const active = accountService.listActiveAccounts();
    for (const account of active) {
      expect(getAccountBalance(account.id), account.name).toBe(balanceFromRows(account.id));
    }
    // Total Balance is exactly the accounts, each counted once.
    const sum = active.reduce((total, account) => total + getAccountBalance(account.id), 0);
    expect(home().totalBalanceMinor).toBe(sum);
  });

  it('keeps borrowing, lending, repayments, transfers and investment capital out of income and expense', () => {
    const f = buildCanonical();
    const report = septemberReport();
    // Income is the salary and the dividend: not the 12,000 borrowed, the 3,000
    // repaid to you, or the 4,750 a sale returned.
    expect(report.incomeMinor).toBe(rupees(65_000 + 500));
    // Expense is the food alone: not the 8,000 lent, the 4,000 repaid, the
    // 10,000 transferred, or the 10,100 invested.
    expect(report.expenseMinor).toBe(rupees(5_000));
    const incomeRows = rawClient()
      .prepare(
        "SELECT count(*) AS total FROM transactions WHERE deleted_at IS NULL AND type = 'income'",
      )
      .get() as { total: number };
    expect(Number(incomeRows.total)).toBe(2);
    expect(transactions.getTransaction(f.transfer.id).type).toBe('transfer');
  });

  it('counts only expenses against a budget', () => {
    const f = buildCanonical();
    budgetService.createBudget({
      categoryId: null,
      periodMonth: MONTH,
      amountMinor: rupees(40_000),
      currency: 'NPR',
    });
    budgetService.createBudget({
      categoryId: f.food.id,
      periodMonth: MONTH,
      amountMinor: rupees(10_000),
      currency: 'NPR',
    });
    const summary = budgetService.getMonthlyBudgetSummary(MONTH);
    expect(summary.overallBudget?.spentMinor).toBe(rupees(5_000));
    expect(summary.categoryBudgets.map((item) => item.spentMinor)).toEqual([rupees(5_000)]);
  });

  it('moves every dependent figure exactly once when an expense is edited, moved, recategorized, backdated and deleted', () => {
    const f = buildCanonical();
    budgetService.createBudget({
      categoryId: null,
      periodMonth: MONTH,
      amountMinor: rupees(40_000),
      currency: 'NPR',
    });
    budgetService.createBudget({
      categoryId: f.food.id,
      periodMonth: MONTH,
      amountMinor: rupees(10_000),
      currency: 'NPR',
    });
    const spent = () => {
      const summary = budgetService.getMonthlyBudgetSummary(MONTH);
      return {
        overall: summary.overallBudget?.spentMinor,
        food: summary.categoryBudgets.find((item) => item.budget.categoryId === f.food.id)
          ?.spentMinor,
      };
    };
    const total = home().totalBalanceMinor;

    transactions.updateExpense(f.lunch.id, { amountMinor: rupees(6_000) });
    expect(getAccountBalance(f.cash.id)).toBe(rupees(19_000));
    expect(septemberReport().expenseMinor).toBe(rupees(6_000));
    expect(spent()).toEqual({ overall: rupees(6_000), food: rupees(6_000) });
    expect(home().totalBalanceMinor).toBe(total - rupees(1_000));

    transactions.updateExpense(f.lunch.id, { accountId: f.bank.id });
    expect(getAccountBalance(f.cash.id)).toBe(rupees(25_000));
    expect(getAccountBalance(f.bank.id)).toBe(rupees(152_150));
    expect(home().totalBalanceMinor).toBe(total - rupees(1_000));

    transactions.updateExpense(f.lunch.id, { categoryId: f.other.id });
    expect(spent()).toEqual({ overall: rupees(6_000), food: 0 });

    transactions.updateExpense(f.lunch.id, { transactionDate: new Date(2026, 7, 20) });
    expect(septemberReport().expenseMinor).toBe(0);
    expect(augustReport().expenseMinor).toBe(rupees(6_000));
    expect(spent()).toEqual({ overall: 0, food: 0 });

    transactions.deleteTransaction(f.lunch.id);
    expect(augustReport().expenseMinor).toBe(0);
    expect(getAccountBalance(f.bank.id)).toBe(rupees(158_150));
    expect(home().totalBalanceMinor).toBe(total + rupees(5_000));
  });

  it('keeps a transfer neutral through an edit, a backdate and a delete', () => {
    const f = buildCanonical();
    const total = home().totalBalanceMinor;
    const report = septemberReport();

    transactions.updateTransfer(f.transfer.id, { amountMinor: rupees(15_000) });
    expect(getAccountBalance(f.bank.id)).toBe(rupees(153_150));
    expect(getAccountBalance(f.cash.id)).toBe(rupees(25_000));
    transactions.updateTransfer(f.transfer.id, { transactionDate: new Date(2026, 7, 3) });
    expect(augustReport()).toMatchObject({ incomeMinor: 0, expenseMinor: 0 });
    expect(home().totalBalanceMinor).toBe(total);
    expect(septemberReport()).toEqual(report);

    transactions.deleteTransaction(f.transfer.id);
    expect(getAccountBalance(f.bank.id)).toBe(rupees(168_150));
    expect(getAccountBalance(f.cash.id)).toBe(rupees(10_000));
    expect(home().totalBalanceMinor).toBe(total);
    expect(septemberReport()).toEqual(report);
  });

  it('refuses a repayment larger than what is outstanding, in either direction', () => {
    const f = buildCanonical();
    const report = septemberReport();
    expect(() =>
      transactions.createRepaymentReceived({
        personId: f.ram.id,
        amountMinor: rupees(5_001),
        accountId: f.cash.id,
        transactionDate: september(21),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      transactions.createRepaymentPaid({
        personId: f.sita.id,
        amountMinor: rupees(8_001),
        accountId: f.bank.id,
        transactionDate: september(21),
      }),
    ).toThrow(ValidationError);
    expect(septemberReport()).toEqual(report);
    expect(transactions.getPersonFinancialSummary(f.ram.id).receivableMinor).toBe(rupees(5_000));
  });

  it('gives a schedule no financial effect until a date is generated, and generates it once', () => {
    const f = buildCanonical();
    const before = {
      cash: getAccountBalance(f.cash.id),
      report: septemberReport(),
      transactions: count('transactions'),
    };
    const template = recurring.createRecurringTemplate({
      type: 'expense',
      amountMinor: rupees(1_000),
      categoryId: f.other.id,
      accountId: f.cash.id,
      startDate: '2026-09-10',
      frequency: 'monthly',
      title: 'Internet',
    });
    // A template and its due date move nothing.
    expect(recurring.listDueOccurrences({ asOfDate: AS_OF_DATE }).occurrences).toHaveLength(1);
    expect({
      cash: getAccountBalance(f.cash.id),
      report: septemberReport(),
      transactions: count('transactions'),
    }).toEqual(before);

    const skipped = recurring.createRecurringTemplate({
      type: 'expense',
      amountMinor: rupees(700),
      categoryId: f.other.id,
      accountId: f.cash.id,
      startDate: '2026-09-12',
      frequency: 'monthly',
      title: 'Gym',
    });
    recurring.skipOccurrence(skipped.id, '2026-09-12', { asOfDate: AS_OF_DATE });
    expect({
      cash: getAccountBalance(f.cash.id),
      report: septemberReport(),
      transactions: count('transactions'),
    }).toEqual(before);

    const first = recurring.generateOccurrence(template.id, '2026-09-10', { asOfDate: AS_OF_DATE });
    const second = recurring.generateOccurrence(template.id, '2026-09-10', {
      asOfDate: AS_OF_DATE,
    });
    // The second attempt reports the date as already handled, with the same records.
    expect(first.outcome).toBe('generated');
    expect(second.outcome).toBe('already_generated');
    expect({ ...second, outcome: first.outcome }).toEqual(first);
    expect(count('transactions')).toBe(before.transactions + 1);
    expect(getAccountBalance(f.cash.id)).toBe(before.cash - rupees(1_000));
    expect(septemberReport().expenseMinor).toBe(before.report.expenseMinor + rupees(1_000));
  });

  it('never adds two currencies together on Home, Reports, People or the transaction list', () => {
    const f = buildCanonical();
    const dollarAccount = makeAccount('Dollar Account', 'USD', dollars(1_000));
    const anish = makePerson('Anish');
    transactions.createIncome({
      amountMinor: dollars(200),
      categoryId: incomeCategory().id,
      accountId: dollarAccount.id,
      transactionDate: september(2),
      title: 'Freelance',
    });
    transactions.createExpense({
      amountMinor: dollars(50),
      categoryId: f.food.id,
      accountId: dollarAccount.id,
      transactionDate: september(10),
      title: 'Books',
    });
    transactions.createLend({
      personId: anish.id,
      amountMinor: dollars(100),
      accountId: dollarAccount.id,
      transactionDate: september(11),
    });

    // Home: the default currency's figures are exactly what they were, and the
    // dollars are a balance of their own.
    expect(home()).toMatchObject({
      currency: 'NPR',
      accountCount: 2,
      totalBalanceMinor: rupees(178_150),
      monthlyIncomeMinor: rupees(65_500),
      monthlyExpenseMinor: rupees(5_000),
      otherCurrencies: [{ currency: 'USD', accountCount: 1, totalBalanceMinor: dollars(1_050) }],
    });
    expect(getDashboardSummary({ now: NOW, currency: 'USD' })).toMatchObject({
      totalBalanceMinor: dollars(1_050),
      monthlyIncomeMinor: dollars(200),
      monthlyExpenseMinor: dollars(50),
      otherCurrencies: [{ currency: 'NPR', totalBalanceMinor: rupees(178_150) }],
    });

    // Reports: one currency at a time, and the screen can name the others.
    const range = getReportRange('this_month', NOW);
    expect(getReportSummary(range, { currency: 'NPR' }).incomeMinor).toBe(rupees(65_500));
    expect(getReportSummary(range, { currency: 'USD' }).incomeMinor).toBe(dollars(200));
    expect(listReportCurrencies(range)).toEqual(['NPR', 'USD']);

    // People: totals per currency.
    expect(
      transactions
        .getPeopleFinancialSummaryByCurrency()
        .map((group) => [group.currency, group.totalReceivableMinor, group.totalLiabilityMinor]),
    ).toEqual([
      ['NPR', rupees(5_000), rupees(8_000)],
      ['USD', dollars(100), 0],
    ]);

    // The transaction list: a day holding both currencies shows no total.
    const groups = groupTransactionsByDay(transactions.listTransactionViews());
    const secondOfSeptember = groups.find((group) => group.key === '2026-09-02');
    expect(secondOfSeptember?.mixedCurrencies).toBe(true);
    expect(groups.find((group) => group.key === '2026-09-10')?.mixedCurrencies).toBe(false);
  });
});
