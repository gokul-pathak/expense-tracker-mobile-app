import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { listCategories, listExpenseCategories } from '@/features/categories/category.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import { listPeople } from '@/features/people/person.service';
import * as recurring from '@/features/recurring/recurring.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { getAppSettings } from '@/features/settings/settings.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactions from '@/features/transactions/transaction.service';

import { incomeCategory, makeAccount, makePerson } from '../support/domain';
import { rawClient } from '../support/test-database';

/**
 * The release audit's canonical fixture, and a way to compare two databases by
 * what they mean rather than by local row ids.
 *
 * Canonical (every figure is checked by hand in the accounting audit):
 *
 *   Cash opens at 20,000, Bank at 100,000.
 *   Salary 65,000 → Bank; Food 5,000 ← Cash; Transfer 10,000 Bank → Cash;
 *   Lend Ram 8,000 ← Cash; Ram repays 3,000 → Cash;
 *   Borrow Sita 12,000 → Bank; repay Sita 4,000 ← Bank;
 *   Buy 10 ABC at 1,000 + fee 100 ← Bank; sell 4 at 1,200 − fee 50 → Bank;
 *   Dividend 500 → Bank.
 *
 *   Cash 20,000 · Bank 158,150 · Total 178,150
 *   Income 65,500 (salary and the dividend) · Expense 5,000 · Savings 60,500
 *   Ram owes 5,000 · owed to Sita 8,000 · 6 ABC held, cost basis 6,060, realized 710
 */

export const rupees = (amount: number) => amount * 100;
export const september = (day: number) => new Date(2026, 8, day, 10);
export const NOW = september(25);
export const AS_OF_DATE = '2026-09-25';
export const MONTH = '2026-09';

export function buildCanonical() {
  const cash = makeAccount('Cash', 'NPR', rupees(20_000));
  const bank = makeAccount('Bank', 'NPR', rupees(100_000));
  const ram = makePerson('Ram');
  const sita = makePerson('Sita');
  const [food, other] = listExpenseCategories();
  if (food === undefined || other === undefined)
    throw new Error('Seeded expense categories missing.');
  const salaryCategory = incomeCategory();

  const salary = transactions.createIncome({
    amountMinor: rupees(65_000),
    categoryId: salaryCategory.id,
    accountId: bank.id,
    transactionDate: september(1),
    title: 'Salary',
  });
  const lunch = transactions.createExpense({
    amountMinor: rupees(5_000),
    categoryId: food.id,
    accountId: cash.id,
    transactionDate: september(2),
    title: 'Food',
  });
  const transfer = transactions.createTransfer({
    amountMinor: rupees(10_000),
    sourceAccountId: bank.id,
    destinationAccountId: cash.id,
    transactionDate: september(3),
  });
  const lend = transactions.createLend({
    personId: ram.id,
    amountMinor: rupees(8_000),
    accountId: cash.id,
    transactionDate: september(4),
  });
  transactions.createRepaymentReceived({
    personId: ram.id,
    amountMinor: rupees(3_000),
    accountId: cash.id,
    transactionDate: september(5),
  });
  transactions.createBorrow({
    personId: sita.id,
    amountMinor: rupees(12_000),
    accountId: bank.id,
    transactionDate: september(6),
  });
  transactions.createRepaymentPaid({
    personId: sita.id,
    amountMinor: rupees(4_000),
    accountId: bank.id,
    transactionDate: september(7),
  });
  const asset = investments.createAsset({
    name: 'ABC Shares',
    assetType: 'stock',
    currency: 'NPR',
  });
  investments.buyAsset({
    assetId: asset.id,
    accountId: bank.id,
    quantityMinor: parseQuantity('10'),
    unitPriceMinor: rupees(1_000),
    feeMinor: rupees(100),
    tradeDate: september(8),
  });
  investments.sellAsset({
    assetId: asset.id,
    accountId: bank.id,
    quantityMinor: parseQuantity('4'),
    unitPriceMinor: rupees(1_200),
    feeMinor: rupees(50),
    tradeDate: september(15),
  });
  const dividend = investments.recordDividend({
    assetId: asset.id,
    accountId: bank.id,
    amountMinor: rupees(500),
    tradeDate: september(20),
  });

  return { cash, bank, ram, sita, food, other, salary, lunch, transfer, lend, asset, dividend };
}

/**
 * The canonical fixture plus one of everything else a person can own: a budget
 * for the month and for Food, a monthly schedule with one date generated and one
 * skipped, and a manual price.
 */
export function buildEverything() {
  const canonical = buildCanonical();
  const overallBudget = budgetService.createBudget({
    categoryId: null,
    periodMonth: MONTH,
    amountMinor: rupees(40_000),
    currency: 'NPR',
  });
  const foodBudget = budgetService.createBudget({
    categoryId: canonical.food.id,
    periodMonth: MONTH,
    amountMinor: rupees(10_000),
    currency: 'NPR',
  });
  const template = recurring.createRecurringTemplate({
    type: 'expense',
    amountMinor: rupees(1_000),
    categoryId: canonical.other.id,
    accountId: canonical.cash.id,
    startDate: '2026-08-10',
    frequency: 'monthly',
    title: 'Internet',
  });
  recurring.generateOccurrence(template.id, '2026-08-10', { asOfDate: AS_OF_DATE });
  recurring.skipOccurrence(template.id, '2026-09-10', { asOfDate: AS_OF_DATE });
  const price = investments.addPrice({
    assetId: canonical.asset.id,
    priceMinor: rupees(1_200),
    priceDate: '2026-09-10',
  });
  return { ...canonical, overallBudget, foodBudget, template, price };
}

const bySyncId = <T extends { syncId: string | null }>(left: T, right: T) =>
  String(left.syncId) < String(right.syncId) ? -1 : 1;

function rows(sql: string) {
  return rawClient().prepare(sql).all();
}

/**
 * Everything a person could see, keyed by global identity: every balance, Home,
 * this month's report, what people owe, the month's budgets, every schedule, and
 * the portfolio. Two databases that agree here agree about the person's money.
 */
export function logicalState(now: Date = NOW) {
  const dashboard = getDashboardSummary({ now });
  const budget = budgetService.getMonthlyBudgetSummary(MONTH);
  const overview = portfolio.getPortfolioOverview({ asOf: now });
  return {
    settings: getAppSettings().defaultCurrency,
    accounts: accountService
      .listAccounts()
      .map((account) => ({
        syncId: account.syncId,
        name: account.name,
        currency: account.currency,
        archived: account.isArchived,
        balance: getAccountBalance(account.id),
      }))
      .sort(bySyncId),
    categories: listCategories()
      .map((category) => ({ syncId: category.syncId, name: category.name, type: category.type }))
      .sort(bySyncId),
    people: listPeople()
      .map((person) => {
        const summary = transactions.getPersonFinancialSummary(person.id);
        return {
          syncId: person.syncId,
          name: person.name,
          receivable: summary.receivableMinor,
          liability: summary.liabilityMinor,
        };
      })
      .sort(bySyncId),
    transactions: rows(
      'SELECT sync_id, type, amount_minor, currency, transaction_date, title FROM transactions WHERE deleted_at IS NULL ORDER BY sync_id',
    ),
    dashboard: {
      currency: dashboard.currency,
      accountCount: dashboard.accountCount,
      totalBalanceMinor: dashboard.totalBalanceMinor,
      monthlyIncomeMinor: dashboard.monthlyIncomeMinor,
      monthlyExpenseMinor: dashboard.monthlyExpenseMinor,
      monthlySavingsMinor: dashboard.monthlySavingsMinor,
      categorySpending: dashboard.categorySpending.map((item) => [
        item.categoryName,
        item.amountMinor,
      ]),
      otherCurrencies: dashboard.otherCurrencies,
    },
    report: getReportSummary(getReportRange('this_month', now)),
    budget: {
      overall:
        budget.overallBudget === null
          ? null
          : [budget.overallBudget.budget.amountMinor, budget.overallBudget.spentMinor],
      categories: budget.categoryBudgets
        .map((item) => [item.categoryName, item.budget.amountMinor, item.spentMinor])
        .sort(),
    },
    templates: rows(
      'SELECT sync_id, title, amount_minor, is_paused FROM recurring_templates WHERE deleted_at IS NULL ORDER BY sync_id',
    ),
    occurrences: rows(
      'SELECT sync_id, occurrence_date, status FROM recurring_occurrences ORDER BY sync_id',
    ),
    due: recurring.listDueOccurrences({ asOfDate: AS_OF_DATE }).occurrences.length,
    trades: rows(
      'SELECT sync_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, amount_minor FROM investment_trades WHERE deleted_at IS NULL ORDER BY sync_id',
    ),
    prices: rows(
      'SELECT sync_id, price_minor, price_date FROM investment_prices WHERE deleted_at IS NULL ORDER BY sync_id',
    ),
    holdings: overview.holdings
      .map(({ assetId: _assetId, ...holding }) => holding)
      .sort((left, right) => (left.name < right.name ? -1 : 1)),
    portfolio: overview.summary.currencies,
  };
}
