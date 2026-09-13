import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { prepareInsightRequest } from '@/features/ai/insights/assistant.service';
import * as budgetService from '@/features/budgets/budget.service';
import { INSIGHT_REQUEST_MAX_BYTES } from '@/features/ai/insights/assistant.types';
import { buildFinancialContext } from '@/features/insights/financial-context.service';
import { CONTEXT_LIMITS } from '@/features/insights/financial-context.types';
import { resolvePresetPeriod } from '@/features/insights/insight-period';
import { contextPlanFor, routeInsightQuestion } from '@/features/insights/insight-router';
import { buildLocalInsights } from '@/features/insights/local-insights';
import * as recurringService from '@/features/recurring/recurring.service';
import { getExpenseCategoryBreakdown, getReportRange } from '@/features/reports/reports.service';
import { createSyncId } from '@/features/sync/uuid';
import * as transactionService from '@/features/transactions/transaction.service';

import { validateInsightRequest } from '../../supabase/functions/_shared/financial-insight/context-validation.ts';
import { incomeCategory } from '../recurring/fixture';
import { makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * Ten thousand transactions, a hundred budgets, a hundred recurring templates
 * and fifty people — and every context stays the same small size.
 *
 * The assertion that matters is not the clock, which depends on the machine.
 * It is that a question's payload does not grow with the history behind it:
 * the domain services aggregate in SQL, the builder takes a bounded top N, and
 * nothing is copied row by row into what would be sent.
 */

const TRANSACTIONS = 10_000;
const CATEGORIES = 100;
const TEMPLATES = 100;
const PEOPLE = 50;
const NOW = new Date(2026, 8, 13, 10);

const categoryIds: number[] = [];
let npr = 0;
const measured: { label: string; ms: number; bytes: number }[] = [];

function buildLargeHistory() {
  const client = rawClient();
  const now = Date.now();
  const salary = incomeCategory('Salary').id;

  client.exec('BEGIN');
  const insertCategory = client.prepare(
    'INSERT INTO categories (name, type, icon, system_key, is_default, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
  );
  for (let index = 0; index < CATEGORIES; index += 1) {
    const row = insertCategory.get(
      `Custom ${index}`,
      'expense',
      null,
      null,
      0,
      now,
      now,
      createSyncId(),
    );
    categoryIds.push(Number((row as { id: number }).id));
  }

  const insertAccount = client.prepare(
    'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
  );
  npr = Number(
    (
      insertAccount.get('Cash', 'cash', 100_000_000_000, 'NPR', 0, now, now, createSyncId()) as {
        id: number;
      }
    ).id,
  );
  const usd = Number(
    (
      insertAccount.get('Dollars', 'bank', 1_000_000_000, 'USD', 0, now, now, createSyncId()) as {
        id: number;
      }
    ).id,
  );

  const insertTransaction = client.prepare(
    'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, destination_account_id, person_id, payment_mode, transaction_date, title, note, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (let index = 0; index < TRANSACTIONS; index += 1) {
    const income = index % 10 === 0;
    const dollars = index % 50 === 1;
    const account = dollars ? usd : npr;
    insertTransaction.run(
      income ? 'income' : 'expense',
      100 + (index % 997) * 7,
      dollars ? 'USD' : 'NPR',
      income ? salary : categoryIds[index % CATEGORIES]!,
      income ? null : account,
      income ? account : null,
      null,
      'cash',
      new Date(2026, 8 - (index % 12), 1 + (index % 13), 12).getTime(),
      `Entry ${index}`,
      index % 3 === 0 ? `Note ${index} call 98123${String(index).padStart(5, '0')}` : null,
      now,
      now,
      createSyncId(),
    );
  }

  const insertBudget = client.prepare(
    'INSERT INTO budgets (category_id, period_month, amount_minor, currency, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?)',
  );
  for (const categoryId of categoryIds) {
    insertBudget.run(categoryId, '2026-09', 10_000, 'NPR', now, now, createSyncId());
  }
  client.exec('COMMIT');

  for (let index = 0; index < TEMPLATES; index += 1) {
    recurringService.createRecurringTemplate({
      type: 'expense',
      amountMinor: 1_000 + index,
      categoryId: categoryIds[index]!,
      accountId: npr,
      startDate: '2026-09-01',
      frequency: 'monthly',
      title: `Plan ${index}`,
    });
  }
  for (let index = 0; index < PEOPLE; index += 1) {
    const person = makePerson(`Friend ${index}`);
    transactionService.createLend({
      personId: person.id,
      accountId: npr,
      amountMinor: 10_000 + index,
      transactionDate: new Date(2026, 8, 1, 12),
    });
  }
}

const QUESTIONS = [
  'How much did I spend this month?',
  'Where did my money go?',
  'What are my biggest expenses?',
  'How does this month compare with last month?',
  'Am I over any budgets?',
  'How much money do I have?',
  'Which accounts have the most money?',
  'How much do people owe me?',
  'Who owes me the most?',
  'What recurring expenses are due?',
];

function build(question: string, preset: 'this_month' | 'this_year' = 'this_month') {
  const routed = routeInsightQuestion(question, resolvePresetPeriod(preset, NOW), NOW);
  if (routed.kind !== 'insight') throw new Error(`not an insight question: ${question}`);
  const started = performance.now();
  const built = buildFinancialContext(contextPlanFor(routed), NOW);
  const ms = performance.now() - started;
  return { routed, built, ms };
}

describe('a large history', () => {
  beforeAll(async () => {
    await setupDatabase();
    buildLargeHistory();
  }, 300_000);

  afterAll(() => {
    console.log(
      `insight contexts over ${TRANSACTIONS} transactions:\n` +
        measured
          .map((item) => `  ${item.label}: ${item.ms.toFixed(1)}ms, ${item.bytes} bytes`)
          .join('\n'),
    );
    closeTestDatabase();
  });

  it.each(QUESTIONS)(
    '"%s" stays small, and the server accepts it',
    (question) => {
      for (const preset of ['this_month', 'this_year'] as const) {
        const { routed, built, ms } = build(question, preset);
        const outcome = prepareInsightRequest({
          question,
          intent: routed.intent,
          context: built.context,
        });
        expect(outcome.kind).toBe('ready');
        if (outcome.kind !== 'ready') return;
        const wire = JSON.stringify(outcome.prepared.request);
        expect(wire.length).toBeLessThan(INSIGHT_REQUEST_MAX_BYTES);
        expect(validateInsightRequest(JSON.parse(wire)).ok).toBe(true);
        measured.push({ label: `${question} (${preset})`, ms, bytes: wire.length });
      }
    },
    60_000,
  );

  it('bounds every section, however much lies behind it', () => {
    const categories = build('Where did my money go?', 'this_year').built.context.categories;
    const breakdown = getExpenseCategoryBreakdown(getReportRange('this_year', NOW), {
      currency: 'NPR',
    });
    expect(breakdown.length).toBeGreaterThan(CONTEXT_LIMITS.topCategories * 10);
    expect(categories?.[0]?.top).toHaveLength(CONTEXT_LIMITS.topCategories);
    expect(categories?.[0]?.otherCategories?.count).toBe(
      breakdown.length - CONTEXT_LIMITS.topCategories,
    );

    const largest = build('What are my biggest expenses?', 'this_year').built.context
      .largestExpenses;
    expect(largest?.every((group) => group.items.length <= CONTEXT_LIMITS.largestExpenses)).toBe(
      true,
    );

    const budgets = build('Am I over any budgets?').built.context.budgets?.byCurrency[0];
    const engine = budgetService.getMonthlyBudgetSummary('2026-09', 'NPR').categoryBudgets;
    expect(budgets?.categories).toHaveLength(CONTEXT_LIMITS.budgetCategories);
    expect(budgets?.omittedCount).toBe(engine.length - CONTEXT_LIMITS.budgetCategories);

    const recurring = build('What recurring expenses are due?').built.context.recurring;
    expect(recurring?.dueCount).toBe(TEMPLATES);
    expect(recurring?.items).toHaveLength(CONTEXT_LIMITS.recurringItems);

    const people = build('Who owes me the most?').built.context.lending?.byCurrency[0];
    expect(people?.peopleWithBalance).toBe(PEOPLE);
    expect(people?.people).toHaveLength(CONTEXT_LIMITS.people);
  }, 60_000);

  it('builds the local insight cards from the same bounded reads', () => {
    for (const preset of ['this_month', 'this_year'] as const) {
      const started = performance.now();
      const cards = buildLocalInsights(resolvePresetPeriod(preset, NOW), NOW);
      measured.push({
        label: `local insight cards (${preset})`,
        ms: performance.now() - started,
        bytes: JSON.stringify(cards).length,
      });
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThanOrEqual(12);
    }
  }, 60_000);
});
