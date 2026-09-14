import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.stubGlobal('__DEV__', false);

import { runSeed } from '@/db/seed';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * A fresh install, repeated startups, and the shape of what is stored.
 *
 * Every derived figure — a balance, what a budget has spent, a holding, a gain, how
 * many recurring dates are due — is computed from source records on every read.
 * Storing one would give it a way to disagree with the records it came from, so
 * this checks the schema itself holds no such column.
 */

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function counts() {
  return {
    categories: count('categories'),
    settings: count('settings'),
    accounts: count('accounts'),
    people: count('people'),
    transactions: count('transactions'),
    budgets: count('budgets'),
    recurringTemplates: count('recurring_templates'),
    recurringOccurrences: count('recurring_occurrences'),
    investmentAssets: count('investment_assets'),
    investmentTrades: count('investment_trades'),
    investmentPrices: count('investment_prices'),
    receiptDrafts: count('receipt_drafts'),
    outbox: count('sync_outbox'),
  };
}

describe('a fresh install', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('seeds built-in categories and one settings row, and no financial record', () => {
    const seeded = counts();
    expect(seeded.categories).toBeGreaterThan(0);
    expect(seeded).toMatchObject({
      settings: 1,
      accounts: 0,
      people: 0,
      transactions: 0,
      budgets: 0,
      recurringTemplates: 0,
      recurringOccurrences: 0,
      investmentAssets: 0,
      investmentTrades: 0,
      investmentPrices: 0,
      receiptDrafts: 0,
    });
    // Every seeded category is a built-in one with a stable key and identity.
    expect(count('categories', 'system_key IS NULL')).toBe(0);
    expect(count('categories', 'sync_id IS NULL')).toBe(0);
  });

  it('seeds nothing twice however many times the app starts', async () => {
    const first = counts();
    await runSeed();
    await runSeed();
    await runSeed();
    expect(counts()).toEqual(first);
    const duplicates = rawClient()
      .prepare(
        'SELECT system_key, count(*) AS total FROM categories GROUP BY system_key HAVING count(*) > 1',
      )
      .all();
    expect(duplicates).toEqual([]);
  });

  it('stores no derived figure as mutable truth', () => {
    const tables = (
      rawClient().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    )
      .map((row) => row.name)
      .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('__'));
    const derived =
      /(^|_)(current_)?balance(_minor)?$|spent|remaining|holding|cost_basis|realized|unrealized|market_value|due_count|total_minor|net_minor|receivable|liability/;
    const offenders: string[] = [];
    for (const table of tables) {
      const columns = rawClient().prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      for (const { name } of columns) {
        if (name === 'opening_balance_minor') continue;
        if (derived.test(name)) offenders.push(`${table}.${name}`);
      }
    }
    expect(tables).toEqual(
      expect.arrayContaining([
        'accounts',
        'transactions',
        'budgets',
        'recurring_templates',
        'recurring_occurrences',
        'investment_assets',
        'investment_trades',
        'investment_prices',
      ]),
    );
    expect(offenders).toEqual([]);
  });
});
