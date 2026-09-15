import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import { validateBackup } from '@/features/backup/backup.validation';
import { periodMonthsInRange } from '@/features/budgets/budget.period';
import { getBudgetComparisonForMonths } from '@/features/budgets/budget.reporting';
import * as budgetService from '@/features/budgets/budget.service';
import { listExpenseCategories } from '@/features/categories/category.service';
import { getHomeBudgetSummary } from '@/features/dashboard/dashboard-budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import {
  getHomeCashflow,
  getHomePeopleTotals,
} from '@/features/dashboard/home-quick-stats.service';
import { buildFinancialContext } from '@/features/insights/financial-context.service';
import { resolvePresetPeriod } from '@/features/insights/insight-period';
import { contextPlanFor, routeInsightQuestion } from '@/features/insights/insight-router';
import * as portfolio from '@/features/investments/portfolio.service';
import { deriveOccurrenceSyncId } from '@/features/recurring/recurring-identity';
import * as recurring from '@/features/recurring/recurring.service';
import {
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getReportRange,
  getReportSummary,
  getSimpleInsights,
} from '@/features/reports/reports.service';
import { filterTransactionViews } from '@/features/transactions/transaction-list-filter';
import { groupTransactionsByDay } from '@/features/transactions/transaction-presentation';
import * as transactions from '@/features/transactions/transaction.service';

import { incomeCategory, makeAccount, makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * Every main screen's read over a large, repeatable dataset:
 *
 *   10 accounts · 30 categories · 100 people · 10,000 transactions · 120 budgets
 *   150 recurring templates · 1,000 recurring dates · 200 investment assets
 *   5,000 investment trades · 2,000 manual prices
 *
 * Each read is timed and its SQLite statements are counted — every read goes
 * through `DatabaseSync.prepare`. A count that grows with the number of rows is
 * an N+1; the time budgets are generous on purpose and catch only a read that has
 * stopped being bounded. The measurements are written to the system temp
 * directory as `m10c-large-dataset.json`.
 */

const NOW = new Date(2026, 8, 25, 12);
const AS_OF_DATE = '2026-09-25';
const UNIT = 100_000_000;
const results: { read: string; ms: number; queries: number }[] = [];

function measure<T>(read: string, work: () => T): { result: T; ms: number; queries: number } {
  const prepare = vi.spyOn(rawClient(), 'prepare');
  const started = performance.now();
  const result = work();
  const ms = Math.round(performance.now() - started);
  const queries = prepare.mock.calls.length;
  prepare.mockRestore();
  results.push({ read, ms, queries });
  return { result, ms, queries };
}

function seed() {
  const client = rawClient();
  const now = Date.now();
  const accounts = Array.from({ length: 10 }, (_, index) =>
    makeAccount(`Account ${index}`, 'NPR', 10_000_000),
  );
  const people = Array.from({ length: 100 }, (_, index) => makePerson(`Person ${index}`));

  const insertCategory = client.prepare(
    `INSERT INTO categories (name, type, icon, system_key, is_default, created_at, updated_at, sync_id)
     VALUES (?, 'expense', NULL, NULL, 0, ?, ?, ?)`,
  );
  for (let index = 0; index < 11; index += 1) {
    insertCategory.run(`Custom ${index}`, now, now, randomUUID());
  }
  const expenseCategories = listExpenseCategories();
  const salary = incomeCategory();

  const insertTransaction = client.prepare(
    `INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, destination_account_id, person_id, payment_mode, transaction_date, title, note, created_at, updated_at, sync_id)
     VALUES (?, ?, 'NPR', ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
  );
  const start = new Date(2025, 9, 1).getTime();
  const span = NOW.getTime() - start;
  client.exec('BEGIN');
  for (let index = 0; index < 10_000; index += 1) {
    const account = accounts[index % accounts.length]!;
    const other = accounts[(index + 1) % accounts.length]!;
    // A loan and its repayment share a block of twenty rows, so each person is repaid
    // only what they were lent, and every person has both.
    const person = people[Math.floor(index / 20) % people.length]!;
    const date = start + Math.floor((span * index) / 10_000);
    const kind = index % 20;
    const syncId = randomUUID();
    if (kind < 12) {
      const category = expenseCategories[index % expenseCategories.length]!;
      insertTransaction.run(
        'expense',
        50_000 + (index % 97) * 100,
        category.id,
        account.id,
        null,
        null,
        date,
        index % 3 === 0 ? 'Groceries' : 'Shop',
        date,
        date,
        syncId,
      );
    } else if (kind < 16) {
      insertTransaction.run(
        'income',
        900_000,
        salary.id,
        null,
        account.id,
        null,
        date,
        'Salary',
        date,
        date,
        syncId,
      );
    } else if (kind < 18) {
      insertTransaction.run(
        'transfer',
        20_000,
        null,
        account.id,
        other.id,
        null,
        date,
        'Transfer',
        date,
        date,
        syncId,
      );
    } else if (kind === 18) {
      insertTransaction.run(
        'lend',
        100_000,
        null,
        account.id,
        null,
        person.id,
        date,
        'Money Given',
        date,
        date,
        syncId,
      );
    } else {
      insertTransaction.run(
        'repayment_received',
        10_000,
        null,
        null,
        account.id,
        person.id,
        date,
        'Payment Received',
        date,
        date,
        syncId,
      );
    }
  }
  client.exec('COMMIT');

  const months = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(2025, 9 + index, 1);
    return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  });
  for (const month of months) {
    for (const category of expenseCategories.slice(0, 10)) {
      budgetService.createBudget({
        categoryId: category.id,
        periodMonth: month,
        amountMinor: 2_000_000,
        currency: 'NPR',
      });
    }
  }

  const insertTemplate = client.prepare(
    'INSERT INTO recurring_templates (type, amount_minor, currency, category_id, account_id, title, start_date, frequency, interval_count, is_paused, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
  );
  const insertOccurrence = client.prepare(
    'INSERT INTO recurring_occurrences (template_id, occurrence_date, status, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?)',
  );
  client.exec('BEGIN');
  let occurrences = 0;
  for (let index = 0; index < 150; index += 1) {
    const syncId = randomUUID();
    const category = expenseCategories[index % expenseCategories.length]!;
    const account = accounts[index % accounts.length]!;
    const template = insertTemplate.get(
      'expense',
      150_000,
      'NPR',
      category.id,
      account.id,
      `Plan ${index}`,
      '2026-01-15',
      'monthly',
      1,
      0,
      now,
      now,
      syncId,
    ) as { id: number };
    for (let month = 1; month <= 7 && occurrences < 1_000; month += 1) {
      const date = `2026-${String(month).padStart(2, '0')}-15`;
      insertOccurrence.run(
        template.id,
        date,
        'skipped',
        now,
        now,
        deriveOccurrenceSyncId(syncId, date),
      );
      occurrences += 1;
    }
  }
  client.exec('COMMIT');

  const insertAsset = client.prepare(
    `INSERT INTO investment_assets (name, asset_type, currency, is_archived, created_at, updated_at, sync_id) VALUES (?, 'stock', 'NPR', 0, 1, 1, ?)`,
  );
  const insertTrade = client.prepare(
    `INSERT INTO investment_trades (asset_id, account_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'NPR', ?, ?, ?)`,
  );
  const insertPrice = client.prepare(
    `INSERT INTO investment_prices (asset_id, price_minor, price_date, currency, created_at, updated_at, sync_id) VALUES (?, ?, ?, 'NPR', 1, 1, ?)`,
  );
  const insertCash = client.prepare(
    `INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, destination_account_id, person_id, payment_mode, transaction_date, title, note, created_at, updated_at, sync_id, investment_trade_id) VALUES (?, ?, 'NPR', NULL, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
  );
  const assetIds: number[] = [];
  client.exec('BEGIN');
  for (let asset = 0; asset < 200; asset += 1) {
    const assetId = Number(insertAsset.run(`Asset ${asset}`, randomUUID()).lastInsertRowid);
    assetIds.push(assetId);
    for (let trade = 0; trade < 25; trade += 1) {
      const buying = trade % 2 === 0;
      const day = new Date(2026, 0, 1 + trade).getTime();
      const accountId = accounts[asset % accounts.length]!.id;
      const tradeId = Number(
        insertTrade.run(
          assetId,
          accountId,
          buying ? 'buy' : 'sell',
          day,
          (buying ? 2 : 1) * UNIT,
          100_000,
          buying ? 1_000 : 500,
          day,
          day,
          randomUUID(),
        ).lastInsertRowid,
      );
      // Each trade's linked cash, exactly as recording writes it: 2 × 1,000 + 10 out
      // for a buy, 1 × 1,000 − 5 in for a sale.
      insertCash.run(
        buying ? 'investment' : 'investment_return',
        buying ? 201_000 : 99_500,
        buying ? accountId : null,
        buying ? null : accountId,
        day,
        buying ? 'Investment Purchase' : 'Investment Sale',
        day,
        day,
        randomUUID(),
        tradeId,
      );
    }
    for (let price = 0; price < 10; price += 1) {
      insertPrice.run(
        assetId,
        110_000 + price * 500,
        `2026-03-${String(price + 1).padStart(2, '0')}`,
        randomUUID(),
      );
    }
  }
  client.exec('COMMIT');
  return { assetIds };
}

function countWhere(table: string, where: string): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function count(table: string): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table}`).get();
  return Number((row as { total: number }).total);
}

describe('every main read over a large dataset', () => {
  let assetIds: number[] = [];

  beforeAll(async () => {
    await setupDatabase();
    ({ assetIds } = seed());
  });
  afterAll(() => {
    const path = join(tmpdir(), 'm10c-large-dataset.json');
    writeFileSync(path, JSON.stringify({ dataset: datasetSize(), results }, null, 2));
    console.log(`Large dataset measurements (${path}):\n` + JSON.stringify(results, null, 2));
    closeTestDatabase();
  });

  function datasetSize() {
    return {
      accounts: count('accounts'),
      categories: count('categories'),
      people: count('people'),
      transactions: count('transactions'),
      ordinaryTransactions: countWhere(
        'transactions',
        "type NOT IN ('investment', 'investment_return')",
      ),
      budgets: count('budgets'),
      recurringTemplates: count('recurring_templates'),
      recurringOccurrences: count('recurring_occurrences'),
      investmentAssets: count('investment_assets'),
      investmentTrades: count('investment_trades'),
      investmentPrices: count('investment_prices'),
    };
  }

  it('holds the full-size dataset', () => {
    expect(datasetSize()).toEqual({
      accounts: 10,
      categories: expect.any(Number),
      people: 100,
      transactions: 15_000,
      ordinaryTransactions: 10_000,
      budgets: 120,
      recurringTemplates: 150,
      recurringOccurrences: 1_000,
      investmentAssets: 200,
      investmentTrades: 5_000,
      investmentPrices: 2_000,
    });
    expect(count('categories')).toBeGreaterThanOrEqual(30);
  });

  it('reads Home from aggregates, never a scan per card', () => {
    const { ms, queries, result } = measure('Home', () => ({
      dashboard: getDashboardSummary({ now: NOW }),
      people: getHomePeopleTotals({ currency: 'NPR' }),
      cashflow: getHomeCashflow({ now: NOW, currency: 'NPR' }),
      budget: getHomeBudgetSummary(),
      recurring: recurring.getRecurringHomeSummary(),
      portfolio: portfolio.getPortfolioSummary(),
    }));
    expect(result.dashboard.accountCount).toBe(10);
    expect(result.cashflow.days).toHaveLength(7);
    expect(queries).toBeLessThanOrEqual(40);
    expect(ms).toBeLessThan(15_000);
  });

  it('lists and searches transactions in a bounded read', () => {
    const { ms, queries, result } = measure('Transactions list and search', () => {
      const views = transactions.listTransactionViews();
      const found = filterTransactionViews(views, { search: 'groc', type: 'all', date: 'all' });
      return { views, found, groups: groupTransactionsByDay(found) };
    });
    expect(result.views.length).toBeGreaterThan(0);
    expect(result.found.length).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(3);
    expect(ms).toBeLessThan(15_000);
  });

  it('builds a year of reports with SQL aggregation', () => {
    const range = getReportRange('this_year', NOW);
    const { ms, queries } = measure('Reports, this year', () => {
      const months = periodMonthsInRange(range);
      return {
        summary: getReportSummary(range, { currency: 'NPR' }),
        categories: getExpenseCategoryBreakdown(range, { currency: 'NPR' }),
        trend: getIncomeExpenseTrend(range, 'month', { filters: { currency: 'NPR' }, now: NOW }),
        insights: getSimpleInsights(range, { filters: { currency: 'NPR' }, now: NOW }),
        budgets: months === null ? null : getBudgetComparisonForMonths(months),
      };
    });
    expect(queries).toBeLessThanOrEqual(25);
    expect(ms).toBeLessThan(15_000);
  });

  it('reads a month of budgets without a query per budget', () => {
    const { ms, queries, result } = measure('Budget month', () =>
      budgetService.getMonthlyBudgetSummary('2026-09'),
    );
    expect(result.categoryBudgets).toHaveLength(10);
    expect(queries).toBeLessThanOrEqual(6);
    expect(ms).toBeLessThan(15_000);
  });

  it('lists recurring schedules and what is due without a query per template', () => {
    const { ms, queries } = measure('Recurring list and due dates', () => ({
      templates: recurring.listRecurringTemplates(),
      due: recurring.listDueOccurrences({ asOfDate: AS_OF_DATE }),
    }));
    expect(queries).toBeLessThanOrEqual(8);
    expect(ms).toBeLessThan(15_000);
  });

  it('totals what 100 people owe in a handful of queries', () => {
    const { ms, queries, result } = measure('People', () =>
      transactions.getPeopleFinancialSummaryByCurrency(),
    );
    expect(result[0]?.people.length).toBe(100);
    expect(queries).toBeLessThanOrEqual(4);
    expect(ms).toBeLessThan(15_000);
  });

  it('reads the portfolio in three queries and an asset in a handful', () => {
    const overview = measure('Portfolio', () => portfolio.getPortfolioOverview({ asOf: NOW }));
    expect(overview.result.holdings).toHaveLength(200);
    expect(overview.queries).toBe(3);
    const detail = measure('Asset detail', () =>
      portfolio.getAssetDetail(assetIds[0]!, { asOf: NOW }),
    );
    expect(detail.result.history).toHaveLength(25);
    expect(detail.queries).toBeLessThanOrEqual(5);
  });

  it('builds the AI context from aggregates for a spending question', () => {
    const { ms, queries, result } = measure('AI context builder', () => {
      const routed = routeInsightQuestion(
        'Where did my money go this month?',
        resolvePresetPeriod('this_month', NOW),
        NOW,
      );
      if (routed.kind !== 'insight') throw new Error('Expected a spending question.');
      return buildFinancialContext(contextPlanFor(routed), NOW);
    });
    expect(result).toBeDefined();
    expect(queries).toBeLessThanOrEqual(15);
    expect(ms).toBeLessThan(15_000);
  });

  it('backs up and restores the whole dataset', () => {
    const backup = measure('Backup: create and serialize', () => JSON.stringify(createBackup()));
    expect(backup.result.length).toBeGreaterThan(1_000_000);
    const restored = measure('Backup: validate and restore', () => {
      const parsed = validateBackup(JSON.parse(backup.result));
      restoreBackup(parsed);
    });
    expect(restored.ms).toBeLessThan(60_000);
    expect(count('transactions')).toBe(15_000);
    expect(count('investment_trades')).toBe(5_000);
  });
});
