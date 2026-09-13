import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { archiveAccount } from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { buildFinancialContext } from '@/features/insights/financial-context.service';
import {
  SECTIONS_FOR_INTENT,
  type FinancialAssistantContext,
  type InsightIntent,
} from '@/features/insights/financial-context.types';
import { resolvePresetPeriod } from '@/features/insights/insight-period';
import { contextPlanFor, routeInsightQuestion } from '@/features/insights/insight-router';
import { insightsFromContext } from '@/features/insights/local-insights';
import * as recurringService from '@/features/recurring/recurring.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import type { ReportPreset } from '@/features/reports/reports.types';
import * as transactionService from '@/features/transactions/transaction.service';

import { validateInsightRequest } from '../../supabase/functions/_shared/financial-insight/context-validation.ts';
import { expenseCategory, incomeCategory } from '../recurring/fixture';
import { makeAccount, makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

/**
 * The deterministic financial context, against real SQLite.
 *
 * Every figure is compared with the domain service that owns it, every
 * question is checked for carrying only the sections its intent allows, and
 * every context is passed through the server's own validator — so what the app
 * builds is exactly what the endpoint accepts, and no more.
 */

const NOW = new Date(2026, 8, 13, 10);
const SEPTEMBER = (day: number) => new Date(2026, 8, day, 12);
const AUGUST = (day: number) => new Date(2026, 7, day, 12);
const rupees = (amount: number) => amount * 100;

function ask(question: string, preset: ReportPreset = 'this_month') {
  const routed = routeInsightQuestion(question, resolvePresetPeriod(preset, NOW), NOW);
  if (routed.kind !== 'insight') throw new Error(`not an insight question: ${routed.kind}`);
  const built = buildFinancialContext(contextPlanFor(routed), NOW);
  // What the app builds must be what the server accepts.
  const validation = validateInsightRequest(
    JSON.parse(
      JSON.stringify({ version: 1, intent: routed.intent, question, context: built.context }),
    ),
  );
  expect(validation.ok, `server refused the context for "${question}"`).toBe(true);
  return { routed, built, context: built.context, wire: JSON.stringify(built.context) };
}

function spend(accountId: number, category: string, amount: number, date: Date, note?: string) {
  return transactionService.createExpense({
    accountId,
    categoryId: expenseCategory(category).id,
    amountMinor: rupees(amount),
    transactionDate: date,
    note: note ?? null,
  });
}

function earn(accountId: number, amount: number, date: Date, note?: string) {
  return transactionService.createIncome({
    accountId,
    categoryId: incomeCategory('Salary').id,
    amountMinor: rupees(amount),
    transactionDate: date,
    note: note ?? null,
  });
}

function sections(context: FinancialAssistantContext): string[] {
  return Object.keys(context)
    .filter((key) => !['contextVersion', 'snapshotDate', 'period', 'notes'].includes(key))
    .sort();
}

describe('the financial context', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('answers "where did my money go" with the exact Reports figures, and nothing else', () => {
    const cash = makeAccount('Secret Savings', 'NPR', 0);
    makePerson('Ram');
    earn(cash.id, 65_000, SEPTEMBER(1), 'Salary from Acme Pvt Ltd');
    spend(cash.id, 'Food', 10_000, SEPTEMBER(2), 'Dinner with Ram, call 9812345678');
    spend(cash.id, 'Travel', 8_000, SEPTEMBER(3));
    spend(cash.id, 'Shopping', 7_000, SEPTEMBER(4));

    const { context, wire } = ask('Where did my money go this month?');

    expect(sections(context)).toEqual(['categories', 'summary']);
    expect(context.summary).toEqual([
      {
        currency: 'NPR',
        income: { minor: rupees(65_000), display: 'NPR 65,000.00' },
        expense: { minor: rupees(25_000), display: 'NPR 25,000.00' },
        savings: { minor: rupees(40_000), display: 'NPR 40,000.00' },
      },
    ]);
    expect(context.categories?.[0]?.top).toEqual([
      {
        category: 'Food',
        amount: { minor: rupees(10_000), display: 'NPR 10,000.00' },
        sharePercent: 40,
      },
      {
        category: 'Travel',
        amount: { minor: rupees(8_000), display: 'NPR 8,000.00' },
        sharePercent: 32,
      },
      {
        category: 'Shopping',
        amount: { minor: rupees(7_000), display: 'NPR 7,000.00' },
        sharePercent: 28,
      },
    ]);
    // The same numbers Reports shows, not a second calculation of them.
    const reports = getReportSummary(getReportRange('this_month', NOW));
    expect(context.summary?.[0]?.expense.minor).toBe(reports.expenseMinor);
    expect(context.summary?.[0]?.income.minor).toBe(reports.incomeMinor);

    for (const absent of ['Secret Savings', 'Ram', 'Dinner', '9812345678', 'Acme', 'Salary']) {
      expect(wire).not.toContain(absent);
    }
    expect(context.period).toEqual({
      kind: 'this_month',
      label: 'September 2026 (this month)',
      start: '2026-09-01',
      end: '2026-09-30',
    });
  });

  it.each([
    ['How much did I spend this month?', 'summary'],
    ['Where did my money go?', 'spending_categories'],
    ['What was my biggest expense?', 'largest_expenses'],
    ['How does this month compare with last month?', 'trend'],
    ['Am I over any budgets?', 'budgets'],
    ['How much money do I have?', 'accounts'],
    ['How much do people owe me?', 'lending'],
    ['What recurring expenses are due?', 'recurring'],
  ] as [string, InsightIntent][])('"%s" carries only the %s sections', (question, intent) => {
    const cash = makeAccount('Secret Savings', 'NPR', rupees(100_000));
    const ram = makePerson('Ram');
    spend(cash.id, 'Food', 1_000, SEPTEMBER(2), 'Private note about Ram');
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: rupees(2_000),
      transactionDate: SEPTEMBER(3),
      note: 'Loan for hospital',
    });
    budgetService.createBudget({
      categoryId: expenseCategory('Food').id,
      periodMonth: '2026-09',
      amountMinor: rupees(5_000),
    });
    recurringService.createRecurringTemplate({
      type: 'expense',
      amountMinor: rupees(20_000),
      categoryId: expenseCategory('Bills').id,
      accountId: cash.id,
      startDate: '2026-09-01',
      frequency: 'monthly',
      title: 'Landlord Mr Sharma',
    });

    const { context, wire } = ask(question);

    expect(sections(context)).toEqual([...SECTIONS_FOR_INTENT[intent]].sort());
    // A largest-expenses answer carries each expense's own short, redacted
    // description, which is the one place a note's words can appear.
    const describedHere = intent === 'largest_expenses' ? ['Ram', 'Private note'] : [];
    // Never in any context: names that were not asked for, notes, titles,
    // local ids, sync ids, and anything identifying the person using the app.
    for (const absent of [
      'Secret Savings',
      ...['Ram', 'Private note'].filter((word) => !describedHere.includes(word)),
      'hospital',
      'Sharma',
      'Landlord',
      'syncId',
      'sync_id',
      'accountId',
      'categoryId',
      'personId',
      'email',
      'userId',
    ]) {
      expect(wire).not.toContain(absent);
    }
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });

  it('keeps every section within its bounds', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(10_000_000));
    const names = [
      'Food',
      'Groceries',
      'Shopping',
      'Travel',
      'Fuel',
      'Bills',
      'Health',
      'Entertainment',
      'Education',
      'Family',
      'Gifts',
      'Other',
    ];
    names.forEach((name, index) =>
      spend(cash.id, name, 100 * (index + 1), SEPTEMBER(1 + (index % 12))),
    );

    const { context } = ask('Where did my money go?');
    const categories = context.categories?.[0];
    expect(categories?.top).toHaveLength(8);
    expect(categories?.otherCategories?.count).toBe(4);
    // The rest are grouped, and the parts add up to the total Reports gives.
    const shown = categories!.top.reduce((total, item) => total + item.amount.minor, 0);
    expect(shown + categories!.otherCategories!.amount.minor).toBe(categories!.totalExpense.minor);
    expect(categories?.top.map((item) => item.category)).toEqual([
      'Other',
      'Gifts',
      'Family',
      'Education',
      'Entertainment',
      'Health',
      'Bills',
      'Fuel',
    ]);

    const largest = ask('What are my biggest expenses?').context.largestExpenses;
    expect(largest?.[0]?.items).toHaveLength(5);
  });
});

describe('comparisons', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('derives the difference and percentage from the two Reports summaries', () => {
    const cash = makeAccount('Cash', 'NPR', 0);
    spend(cash.id, 'Food', 12_000, AUGUST(10));
    spend(cash.id, 'Travel', 8_000, AUGUST(12));
    spend(cash.id, 'Food', 19_000, SEPTEMBER(5));
    spend(cash.id, 'Travel', 11_000, SEPTEMBER(6));

    const { context } = ask('How does this month compare with last month?');
    const npr = context.trend?.byCurrency[0];

    expect(context.trend?.previousPeriod.label).toBe('August 2026');
    expect(npr).toMatchObject({
      currentExpense: { minor: rupees(30_000) },
      previousExpense: { minor: rupees(20_000) },
      expenseDifference: { minor: rupees(10_000), display: 'NPR 10,000.00' },
      expensePercentChange: 50,
    });
    // Contributions, largest movement first, calculated here and not by a model.
    expect(npr?.categoryChanges).toEqual([
      {
        category: 'Food',
        current: { minor: rupees(19_000), display: 'NPR 19,000.00' },
        previous: { minor: rupees(12_000), display: 'NPR 12,000.00' },
        difference: { minor: rupees(7_000), display: 'NPR 7,000.00' },
      },
      {
        category: 'Travel',
        current: { minor: rupees(11_000), display: 'NPR 11,000.00' },
        previous: { minor: rupees(8_000), display: 'NPR 8,000.00' },
        difference: { minor: rupees(3_000), display: 'NPR 3,000.00' },
      },
    ]);
    expect(context.notes.join(' ')).toContain('still in progress');
  });

  it('has no percentage, and no Infinity, when the previous period had nothing', () => {
    const cash = makeAccount('Cash', 'NPR', 0);
    spend(cash.id, 'Food', 5_000, SEPTEMBER(5));

    const { context, wire } = ask('How does this month compare with last month?');

    expect(context.trend?.byCurrency[0]?.expensePercentChange).toBeNull();
    expect(wire).not.toMatch(/Infinity|NaN/);
    expect(context.notes.join(' ')).toContain('No NPR expenses were recorded in August 2026');
    const card = insightsFromContext(context).find((item) => item.id.startsWith('trend'));
    expect(card?.description).toBe(
      'NPR 5,000.00 this period, compared with no recorded expenses in August 2026.',
    );
  });

  it('keeps negative savings negative', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(50_000));
    earn(cash.id, 10_000, SEPTEMBER(1));
    spend(cash.id, 'Food', 15_000, SEPTEMBER(2));

    const { context } = ask('How much did I save this month?');

    expect(context.summary?.[0]?.savings).toEqual({
      minor: -rupees(5_000),
      display: '-NPR 5,000.00',
    });
    expect(insightsFromContext(context)[0]?.description).toBe(
      'Income NPR 10,000.00. Expenses exceeded income by NPR 5,000.00.',
    );
  });

  it('never adds two currencies together', () => {
    const rupeesAccount = makeAccount('Cash', 'NPR', 0);
    const dollars = makeAccount('Dollars', 'USD', rupees(1_000));
    spend(rupeesAccount.id, 'Food', 10_000, SEPTEMBER(2));
    spend(dollars.id, 'Food', 50, SEPTEMBER(3));

    const { context, wire } = ask('How much did I spend this month?');

    expect(context.summary?.map((fact) => [fact.currency, fact.expense.minor])).toEqual([
      ['NPR', rupees(10_000)],
      ['USD', rupees(50)],
    ]);
    expect(wire).not.toContain(String(rupees(10_000) + rupees(50)));
    expect(context.notes.join(' ')).toContain('never added together');
  });

  it('includes spending from an archived account and uses a category’s current name', () => {
    const old = makeAccount('Old Wallet', 'NPR', rupees(10_000));
    spend(old.id, 'Food', 3_000, SEPTEMBER(2));
    archiveAccount(old.id);

    const { context } = ask('How much did I spend this month?');
    expect(context.summary?.[0]?.expense.minor).toBe(rupees(3_000));
  });

  it('builds from one consistent snapshot, synchronously', async () => {
    const cash = makeAccount('Cash', 'NPR', rupees(1_000_000));
    spend(cash.id, 'Food', 1_000, SEPTEMBER(2));
    const routed = routeInsightQuestion(
      'Where did my money go?',
      resolvePresetPeriod('this_month', NOW),
      NOW,
    );
    if (routed.kind !== 'insight') throw new Error('expected an insight');

    let wrote = false;
    // A save queued while the context is being built, as a sync or a tap would be.
    queueMicrotask(() => {
      spend(cash.id, 'Travel', 99_000, SEPTEMBER(3));
      wrote = true;
    });
    const built = buildFinancialContext(contextPlanFor(routed), NOW);

    expect(built).not.toBeInstanceOf(Promise);
    expect(wrote).toBe(false);
    const listed = built.context.categories![0]!.top.reduce(
      (total, item) => total + item.amount.minor,
      0,
    );
    expect(listed).toBe(built.context.summary![0]!.expense.minor);
    await Promise.resolve();
    expect(wrote).toBe(true);
  });
});

describe('budgets', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('reports an overspent budget from the budget engine', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(100_000));
    budgetService.createBudget({
      categoryId: expenseCategory('Food').id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    spend(cash.id, 'Food', 17_000, SEPTEMBER(5));

    const { context } = ask('Am I over any budgets?');
    const group = context.budgets?.byCurrency[0];

    expect(context.budgets?.monthLabel).toBe('September 2026');
    expect(group?.categories[0]).toEqual({
      name: 'Food',
      budgeted: { minor: rupees(15_000), display: 'NPR 15,000.00' },
      spent: { minor: rupees(17_000), display: 'NPR 17,000.00' },
      remaining: { minor: -rupees(2_000), display: '-NPR 2,000.00' },
      overspent: { minor: rupees(2_000), display: 'NPR 2,000.00' },
      percentUsed: 113,
      status: 'over_budget',
    });
    expect(group?.overBudgetCount).toBe(1);
    const progress = budgetService.getMonthlyBudgetSummary('2026-09').categoryBudgets[0]!;
    expect(group?.categories[0]?.overspent.minor).toBe(progress.overspentMinor);
  });

  it('never adds an overall budget to the category budgets it covers', () => {
    budgetService.createBudget({
      categoryId: null,
      periodMonth: '2026-09',
      amountMinor: rupees(50_000),
    });
    budgetService.createBudget({
      categoryId: expenseCategory('Food').id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    budgetService.createBudget({
      categoryId: expenseCategory('Travel').id,
      periodMonth: '2026-09',
      amountMinor: rupees(10_000),
    });

    const { context } = ask('Am I over any budgets?');

    expect(context.budgets?.byCurrency[0]?.totalBudgeted?.minor).toBe(rupees(50_000));
    expect(context.notes.join(' ')).toContain('never added');
  });

  it('uses a single month for a multi-month period, and says so', () => {
    const { context } = ask('Am I over any budgets?', 'last_3_months');
    expect(context.budgets?.month).toBe('2026-09');
    expect(context.notes.join(' ')).toContain('Budgets are monthly, so this uses September 2026');
  });
});

describe('money owed', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  function lendingFixture() {
    const cash = makeAccount('Cash', 'NPR', rupees(100_000));
    const ram = makePerson('Ram');
    const sita = makePerson('Sita');
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: rupees(20_000),
      transactionDate: SEPTEMBER(1),
    });
    transactionService.createBorrow({
      personId: sita.id,
      accountId: cash.id,
      amountMinor: rupees(8_000),
      transactionDate: SEPTEMBER(2),
    });
    return cash;
  }

  it('gives receivable and liability totals, and never calls them income or expense', () => {
    lendingFixture();

    const { context, wire } = ask('How much do people owe me?');

    expect(context.lending?.byCurrency).toEqual([
      {
        currency: 'NPR',
        totalReceivable: { minor: rupees(20_000), display: 'NPR 20,000.00' },
        totalLiability: { minor: rupees(8_000), display: 'NPR 8,000.00' },
        peopleWithBalance: 2,
        people: null,
      },
    ]);
    expect(wire).not.toContain('Ram');
    expect(wire).not.toContain('Sita');
    // Lending is not spending.
    expect(getReportSummary(getReportRange('this_month', NOW))).toEqual({
      incomeMinor: 0,
      expenseMinor: 0,
      savingsMinor: 0,
    });
    expect(context.notes.join(' ')).toContain('not income or expenses');
  });

  it('ranks people under aliases, and keeps the names on the device', () => {
    lendingFixture();

    const { context, built, wire } = ask('Who owes me the most?');

    expect(context.lending?.byCurrency[0]?.people).toEqual([
      {
        label: 'Person 1',
        receivable: { minor: rupees(20_000), display: 'NPR 20,000.00' },
        liability: { minor: 0, display: 'NPR 0.00' },
      },
      {
        label: 'Person 2',
        receivable: { minor: 0, display: 'NPR 0.00' },
        liability: { minor: rupees(8_000), display: 'NPR 8,000.00' },
      },
    ]);
    expect(built.personNames).toEqual({ 'Person 1': 'Ram', 'Person 2': 'Sita' });
    expect(wire).not.toContain('Ram');
    expect(wire).not.toContain('Sita');
  });

  it('names only the person the question named', () => {
    lendingFixture();

    const { context, wire } = ask('How much does Ram owe me?');

    expect(context.lending?.byCurrency[0]?.people).toEqual([
      {
        label: 'Ram',
        receivable: { minor: rupees(20_000), display: 'NPR 20,000.00' },
        liability: { minor: 0, display: 'NPR 0.00' },
      },
    ]);
    expect(wire).not.toContain('Sita');
  });
});

describe('recurring and balances', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  function template(
    accountId: number,
    type: 'expense' | 'income',
    category: string,
    amount: number,
    startDate: string,
    title: string,
  ) {
    return recurringService.createRecurringTemplate({
      type,
      amountMinor: rupees(amount),
      categoryId: type === 'expense' ? expenseCategory(category).id : incomeCategory(category).id,
      accountId,
      startDate,
      frequency: 'monthly',
      title,
    });
  }

  it('distinguishes due expenses from due income, without titles', () => {
    const bank = makeAccount('Bank', 'NPR', rupees(1_000_000));
    template(bank.id, 'expense', 'Bills', 20_000, '2026-09-01', 'Rent to Mr Sharma');
    template(bank.id, 'expense', 'Bills', 1_000, '2026-09-05', 'Internet');
    template(bank.id, 'expense', 'Health', 2_000, '2026-09-10', 'Gym');
    template(bank.id, 'income', 'Salary', 65_000, '2026-09-01', 'Acme payroll');

    const { context, wire } = ask('What recurring expenses are due?');

    expect(context.recurring).toMatchObject({
      asOfDate: '2026-09-13',
      dueCount: 4,
      moreDue: false,
    });
    expect(context.recurring?.totals).toEqual([
      {
        type: 'expense',
        currency: 'NPR',
        count: 3,
        total: { minor: rupees(23_000), display: 'NPR 23,000.00' },
      },
      {
        type: 'income',
        currency: 'NPR',
        count: 1,
        total: { minor: rupees(65_000), display: 'NPR 65,000.00' },
      },
    ]);
    const items = context.recurring?.items ?? [];
    expect(items.map((item) => item.type).sort()).toEqual([
      'expense',
      'expense',
      'expense',
      'income',
    ]);
    // Oldest first, as the recurring engine lists them.
    expect(items.map((item) => item.date)).toEqual([...items.map((item) => item.date)].sort());
    for (const absent of ['Sharma', 'Rent', 'Internet', 'Gym', 'Acme', 'Bank']) {
      expect(wire).not.toContain(absent);
    }
  });

  it('never counts a template and the transaction it generated twice, or a skipped date at all', () => {
    const bank = makeAccount('Bank', 'NPR', rupees(1_000_000));
    const rent = template(bank.id, 'expense', 'Bills', 20_000, '2026-09-01', 'Rent');
    const internet = template(bank.id, 'expense', 'Bills', 1_000, '2026-09-05', 'Internet');
    recurringService.generateOccurrence(rent.id, '2026-09-01', { asOfDate: '2026-09-13' });
    recurringService.skipOccurrence(internet.id, '2026-09-05', { asOfDate: '2026-09-13' });

    const due = ask('What recurring expenses are due?').context.recurring;
    const spent = ask('How much did I spend this month?').context.summary;

    expect(due?.dueCount).toBe(0);
    // The generated rent is an ordinary expense; the skipped internet is nothing.
    expect(spent?.[0]?.expense.minor).toBe(rupees(20_000));
  });

  it('totals active balances per currency, matching Home, and names accounts only when asked', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(30_000));
    const bank = makeAccount('Everest Bank', 'NPR', rupees(20_000));
    const ram = makePerson('Ram');
    spend(cash.id, 'Food', 5_000, SEPTEMBER(2));
    transactionService.createLend({
      personId: ram.id,
      accountId: bank.id,
      amountMinor: rupees(1_000),
      transactionDate: SEPTEMBER(3),
    });

    const totals = ask('How much money do I have?');
    const named = ask('Which accounts have the most money?');

    expect(totals.context.accounts?.byCurrency).toEqual([
      {
        currency: 'NPR',
        totalBalance: { minor: rupees(44_000), display: 'NPR 44,000.00' },
        accountCount: 2,
        accounts: null,
      },
    ]);
    expect(totals.context.accounts?.byCurrency[0]?.totalBalance.minor).toBe(
      getDashboardSummary({ now: NOW }).totalBalanceMinor,
    );
    expect(totals.wire).not.toContain('Everest');
    expect(named.context.accounts?.byCurrency[0]?.accounts).toEqual([
      { name: 'Cash', balance: { minor: rupees(25_000), display: 'NPR 25,000.00' } },
      { name: 'Everest Bank', balance: { minor: rupees(19_000), display: 'NPR 19,000.00' } },
    ]);
    expect(totals.context.notes.join(' ')).toContain('do not include money owed');
  });

  it('lists largest expenses only, with a short redacted description', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(1_000_000));
    const bank = makeAccount('Bank', 'NPR', 0);
    const ram = makePerson('Ram');
    spend(
      cash.id,
      'Bills',
      12_000,
      SEPTEMBER(2),
      'Flat rent, landlord phone 9812345678, pay by Friday please',
    );
    spend(cash.id, 'Food', 5_000, SEPTEMBER(3));
    transactionService.createTransfer({
      amountMinor: rupees(50_000),
      sourceAccountId: cash.id,
      destinationAccountId: bank.id,
      transactionDate: SEPTEMBER(4),
    });
    transactionService.createLend({
      personId: ram.id,
      accountId: cash.id,
      amountMinor: rupees(40_000),
      transactionDate: SEPTEMBER(5),
    });

    const { context, wire } = ask('What was my biggest expense?');
    const items = context.largestExpenses?.[0]?.items ?? [];

    // Transfers and lending are not expenses, however large.
    expect(items.map((item) => item.amount.minor)).toEqual([rupees(12_000), rupees(5_000)]);
    expect(items[0]).toMatchObject({ date: '2026-09-02', category: 'Bills' });
    expect(items[0]?.description?.length).toBeLessThanOrEqual(40);
    expect(wire).not.toContain('9812345678');
    expect(wire).not.toContain('Ram');
  });
});
