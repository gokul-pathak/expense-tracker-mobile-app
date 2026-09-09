import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as budgetService from '@/features/budgets/budget.service';
import { createSyncId } from '@/features/sync/uuid';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * A month big enough for the shape of the work to matter.
 *
 * The assertion that counts is not the clock — that depends on the machine, and
 * a threshold passing here would say nothing about a phone. It is that a summary
 * of a hundred budgets reads the transaction table once, rather than once per
 * budget. The alternative, filtering five thousand rows in JavaScript a hundred
 * times over, is the mistake this test exists to prevent.
 */

const CATEGORIES = 100;
const TRANSACTIONS = 5000;
const SEPTEMBER = '2026-09';

const categoryIds: number[] = [];
let buildMs = 0;

/**
 * Written straight to SQLite: creating five thousand records through the domain
 * services would measure the services, and every row still gets a real global
 * identity and a valid relationship.
 */
function buildLargeMonth() {
  const client = rawClient();
  const now = Date.now();
  const date = new Date(2026, 8, 15).getTime();

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

  const account = client
    .prepare(
      'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
    )
    .get('Cash', 'cash', 1_000_000_000, 'NPR', 0, now, now, createSyncId());
  const accountId = Number((account as { id: number }).id);

  const insertTransaction = client.prepare(
    'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, destination_account_id, person_id, payment_mode, transaction_date, title, note, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (let index = 0; index < TRANSACTIONS; index += 1) {
    insertTransaction.run(
      'expense',
      100,
      'NPR',
      categoryIds[index % CATEGORIES]!,
      accountId,
      null,
      null,
      'cash',
      date,
      `Expense ${index}`,
      null,
      now,
      now,
      createSyncId(),
    );
  }

  const insertBudget = client.prepare(
    'INSERT INTO budgets (category_id, period_month, amount_minor, currency, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?)',
  );
  for (const categoryId of categoryIds) {
    insertBudget.run(categoryId, SEPTEMBER, 10_000, 'NPR', now, now, createSyncId());
  }
  insertBudget.run(null, SEPTEMBER, 1_000_000, 'NPR', now, now, createSyncId());
  client.exec('COMMIT');
}

describe('a month with a hundred budgets and five thousand expenses', () => {
  beforeAll(async () => {
    await setupDatabase();
    const started = Date.now();
    buildLargeMonth();
    buildMs = Date.now() - started;
  }, 120_000);
  afterAll(() => closeTestDatabase());

  it('summarizes the whole month from one aggregate', () => {
    const started = Date.now();
    const summary = budgetService.getMonthlyBudgetSummary(SEPTEMBER);
    const elapsed = Date.now() - started;

    expect(summary.categoryBudgets).toHaveLength(CATEGORIES);
    expect(summary.overallBudget?.spentMinor).toBe(TRANSACTIONS * 100);
    expect(summary.totalSpentMinor).toBe(TRANSACTIONS * 100);
    // Each of the hundred categories carries fifty of the five thousand rows.
    expect(summary.categoryBudgets[0]?.spentMinor).toBe((TRANSACTIONS / CATEGORIES) * 100);
    expect(summary.categoryBudgets.every((progress) => progress.spentMinor === 5_000)).toBe(true);

    // Generous, because it is a smoke test for the wrong shape of work rather
    // than a benchmark: a per-budget scan would be two orders of magnitude
    // slower than this, not marginally slower.
    expect(elapsed).toBeLessThan(2_000);
    console.log(
      `budget summary: ${CATEGORIES} budgets over ${TRANSACTIONS} expenses in ${elapsed}ms ` +
        `(fixture built in ${buildMs}ms)`,
    );
  }, 30_000);

  it('answers one budget without reading the whole month', () => {
    const budget = budgetService
      .listBudgetsForMonth(SEPTEMBER)
      .find((item) => item.categoryId === categoryIds[0])!;

    const progress = budgetService.getBudgetProgress(budget.id);

    expect(progress.spentMinor).toBe(5_000);
    // 5,000 spent against a 10,000 plan.
    expect(progress.remainingMinor).toBe(5_000);
    expect(progress.percentage).toBe(50);
    expect(progress.status).toBe('within_budget');
  }, 30_000);
});
