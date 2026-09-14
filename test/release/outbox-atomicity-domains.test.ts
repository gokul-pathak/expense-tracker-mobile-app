import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as budgetService from '@/features/budgets/budget.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import * as recurring from '@/features/recurring/recurring.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * A domain write and its sync queue entry are one transaction, for every syncable
 * record added after M7 — budgets, recurring schedules and investments.
 *
 * The queue is broken on purpose: every insert, update and delete against it fails
 * while everything else still works. (A second edit of a record whose change is
 * still queued updates the queued entry rather than adding one, so breaking only
 * inserts would not reach it.) Each write must then fail whole. A record saved
 * without its queue entry would never reach another device; a queue entry without
 * its record would upload something that does not exist.
 */

const rupees = (amount: number) => amount * 100;
const AS_OF = '2026-09-20';

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function breakOutboxWrites() {
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    rawClient().exec(
      `CREATE TRIGGER fail_outbox_${operation.toLowerCase()} BEFORE ${operation} ON sync_outbox
       BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END;`,
    );
  }
}

function repairOutboxWrites() {
  for (const operation of ['insert', 'update', 'delete']) {
    rawClient().exec(`DROP TRIGGER IF EXISTS fail_outbox_${operation}`);
  }
}

function state() {
  return {
    budgets: rawClient()
      .prepare('SELECT id, amount_minor, deleted_at FROM budgets ORDER BY id')
      .all(),
    templates: rawClient()
      .prepare('SELECT id, title, deleted_at FROM recurring_templates ORDER BY id')
      .all(),
    occurrences: count('recurring_occurrences'),
    transactions: count('transactions', 'deleted_at IS NULL'),
    assets: rawClient().prepare('SELECT id, is_archived FROM investment_assets ORDER BY id').all(),
    trades: rawClient()
      .prepare('SELECT id, unit_price_minor, deleted_at FROM investment_trades ORDER BY id')
      .all(),
    prices: rawClient()
      .prepare('SELECT id, price_minor, deleted_at FROM investment_prices ORDER BY id')
      .all(),
    outbox: rawClient()
      .prepare('SELECT id, entity_type, operation, revision FROM sync_outbox ORDER BY id')
      .all(),
    pending: countPendingSyncMutations(),
  };
}

describe('every syncable write rolls back with its queue entry', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('budgets: create, update and delete', () => {
    const food = expenseCategory();
    const input = {
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(1_000),
      currency: 'NPR',
    };
    const budget = budgetService.createBudget(input);
    const before = state();
    breakOutboxWrites();

    expect(() =>
      budgetService.createBudget({ ...input, categoryId: null, amountMinor: rupees(5_000) }),
    ).toThrow();
    expect(() =>
      budgetService.updateBudget(budget.id, { ...input, amountMinor: rupees(2_000) }),
    ).toThrow();
    expect(() => budgetService.deleteBudget(budget.id)).toThrow();

    expect(state()).toEqual(before);
    repairOutboxWrites();
    budgetService.updateBudget(budget.id, { ...input, amountMinor: rupees(2_000) });
    expect(budgetService.getBudget(budget.id).amountMinor).toBe(rupees(2_000));
  });

  it('recurring: create, generate, skip, edit and delete', () => {
    const cash = makeAccount('Cash', 'NPR', rupees(10_000));
    const food = expenseCategory();
    const templateInput = {
      type: 'expense' as const,
      amountMinor: rupees(500),
      categoryId: food.id,
      accountId: cash.id,
      startDate: '2026-06-15',
      frequency: 'monthly' as const,
      title: 'Groceries',
    };
    const template = recurring.createRecurringTemplate(templateInput);
    const before = state();
    breakOutboxWrites();

    expect(() => recurring.createRecurringTemplate(templateInput)).toThrow();
    expect(() =>
      recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF }),
    ).toThrow();
    expect(() =>
      recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF }),
    ).toThrow();
    expect(() => recurring.updateRecurringTemplate(template.id, { title: 'Market' })).toThrow();
    expect(() => recurring.deleteRecurringTemplate(template.id)).toThrow();

    expect(state()).toEqual(before);
    expect(getAccountBalance(cash.id)).toBe(rupees(10_000));

    // With the queue healthy again the same date generates exactly one expense.
    repairOutboxWrites();
    const first = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    const second = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(first.outcome).toBe('generated');
    expect({ ...second, outcome: first.outcome }).toEqual(first);
    expect(count('transactions', 'deleted_at IS NULL')).toBe(before.transactions + 1);
    expect(getAccountBalance(cash.id)).toBe(rupees(9_500));
  });

  it('investments: asset, buy, sell, dividend, price, edit, delete and archive', () => {
    const bank = makeAccount('Bank', 'NPR', rupees(100_000));
    const asset = investments.createAsset({ name: 'ABC', assetType: 'stock', currency: 'NPR' });
    const buy = investments.buyAsset({
      assetId: asset.id,
      accountId: bank.id,
      quantityMinor: parseQuantity('10'),
      unitPriceMinor: rupees(1_000),
      tradeDate: new Date(2026, 8, 1),
    });
    const price = investments.addPrice({
      assetId: asset.id,
      priceMinor: rupees(1_200),
      priceDate: '2026-09-10',
    });
    const before = state();
    const balance = getAccountBalance(bank.id);
    breakOutboxWrites();

    const trade = {
      assetId: asset.id,
      accountId: bank.id,
      quantityMinor: parseQuantity('4'),
      unitPriceMinor: rupees(1_200),
      tradeDate: new Date(2026, 8, 15),
    };
    expect(() =>
      investments.createAsset({ name: 'XYZ', assetType: 'etf', currency: 'NPR' }),
    ).toThrow();
    expect(() => investments.buyAsset(trade)).toThrow();
    expect(() => investments.sellAsset(trade)).toThrow();
    expect(() =>
      investments.recordDividend({
        assetId: asset.id,
        accountId: bank.id,
        amountMinor: rupees(500),
        tradeDate: new Date(2026, 8, 20),
      }),
    ).toThrow();
    expect(() =>
      investments.addPrice({
        assetId: asset.id,
        priceMinor: rupees(1_300),
        priceDate: '2026-09-20',
      }),
    ).toThrow();
    expect(() => investments.updatePrice(price.id, { priceMinor: rupees(1_300) })).toThrow();
    expect(() => investments.updateTrade(buy.id, { unitPriceMinor: rupees(900) })).toThrow();
    expect(() => investments.deleteTrade(buy.id)).toThrow();
    expect(() => investments.deletePrice(price.id)).toThrow();
    expect(() => investments.archiveAsset(asset.id)).toThrow();

    // Neither a trade nor its cash may survive half-written.
    expect(state()).toEqual(before);
    expect(getAccountBalance(bank.id)).toBe(balance);
    expect(portfolio.getHolding(asset.id).quantityMinor).toBe(parseQuantity('10'));
  });
});
