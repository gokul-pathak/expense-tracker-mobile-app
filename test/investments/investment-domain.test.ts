import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import * as recurringService from '@/features/recurring/recurring.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { NotFoundError, ValidationError } from '@/features/shared/errors';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory, incomeCategory } from '../recurring/fixture';
import { makeAccount, makePerson, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * The investment domain against real SQLite.
 *
 * The milestone's fixture, permanently: Bank opens at NPR 100,000; buy 10 ABC
 * Shares at 1,000 with a fee of 100; price them at 1,200; sell 4 at 1,200 with a
 * fee of 50; receive a dividend of 500. Every figure the app derives is checked
 * at each step — and so is every figure that must not move.
 */

const rupees = (amount: number) => Math.round(amount * 100);
const shares = (text: string) => parseQuantity(text);
const september = (day: number) => new Date(2026, 8, day);
/** Valuation date: every price below is on or before it. */
const AS_OF = { asOf: new Date(2026, 8, 30, 12) };

type Fixture = { bankId: number; assetId: number };

function fixture(): Fixture {
  const bank = makeAccount('Bank', 'NPR', rupees(100_000));
  const asset = investments.createAsset({
    name: 'ABC Shares',
    symbol: ' abc ',
    assetType: 'stock',
    currency: 'npr',
  });
  return { bankId: bank.id, assetId: asset.id };
}

function buyTen(f: Fixture) {
  return investments.buyAsset({
    assetId: f.assetId,
    accountId: f.bankId,
    quantityMinor: shares('10'),
    unitPriceMinor: rupees(1_000),
    feeMinor: rupees(100),
    tradeDate: september(1),
  });
}

function sellFour(f: Fixture) {
  return investments.sellAsset({
    assetId: f.assetId,
    accountId: f.bankId,
    quantityMinor: shares('4'),
    unitPriceMinor: rupees(1_200),
    feeMinor: rupees(50),
    tradeDate: september(15),
  });
}

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function outboxTypes(): string[] {
  return (
    rawClient().prepare('SELECT entity_type AS type FROM sync_outbox ORDER BY id').all() as {
      type: string;
    }[]
  ).map((row) => row.type);
}

function linkedTransaction(tradeId: number) {
  return rawClient()
    .prepare(
      'SELECT id, type, amount_minor, source_account_id, destination_account_id, category_id, deleted_at FROM transactions WHERE investment_trade_id = ?',
    )
    .get(tradeId) as {
    id: number;
    type: string;
    amount_minor: number;
    source_account_id: number | null;
    destination_account_id: number | null;
    category_id: number | null;
    deleted_at: number | null;
  };
}

function septemberReport() {
  return getReportSummary(getReportRange('this_month', september(20)));
}

describe('the milestone fixture', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('creates an asset with normalized identity fields and no figures of its own', () => {
    const f = fixture();
    const asset = investments.getAsset(f.assetId);
    expect(asset).toMatchObject({ name: 'ABC Shares', symbol: 'ABC', currency: 'NPR' });
    expect(asset.syncId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outboxTypes()).toContain('investment_asset');
  });

  it('buys 10 for 10,100: Bank 89,900, holding 10, cost basis 10,100', () => {
    const f = fixture();
    const buy = buyTen(f);

    expect(getAccountBalance(f.bankId)).toBe(rupees(89_900));
    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding.quantityMinor).toBe(shares('10'));
    expect(holding.costBasisMinor).toBe(rupees(10_100));
    expect(holding.averageUnitCostMinor).toBe(rupees(1_010));

    // One cash transaction, of the investment type, for gross plus fee.
    const cash = linkedTransaction(buy.id);
    expect(cash).toMatchObject({
      type: 'investment',
      amount_minor: rupees(10_100),
      source_account_id: f.bankId,
      destination_account_id: null,
      category_id: null,
    });
    // Trade and cash each queued for upload, once.
    expect(outboxTypes().filter((type) => type === 'investment_trade')).toHaveLength(1);
  });

  it('has an unknown value until a price is entered, then 12,000 with a gain of 1,900', () => {
    const f = fixture();
    buyTen(f);

    const unpriced = portfolio.getHolding(f.assetId, AS_OF);
    expect(unpriced.status).toBe('unpriced');
    expect(unpriced.marketValueMinor).toBeNull();
    expect(unpriced.unrealizedGainMinor).toBeNull();

    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(1_200),
      priceDate: '2026-09-10',
    });

    const priced = portfolio.getHolding(f.assetId, AS_OF);
    expect(priced.status).toBe('priced');
    expect(priced.latestPrice).toEqual({ priceMinor: rupees(1_200), priceDate: '2026-09-10' });
    expect(priced.marketValueMinor).toBe(rupees(12_000));
    expect(priced.unrealizedGainMinor).toBe(rupees(1_900));
  });

  it('sells 4: Bank 94,650, 6 left costing 6,060, realized 710, worth 7,200, unrealized 1,140', () => {
    const f = fixture();
    buyTen(f);
    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(1_200),
      priceDate: '2026-09-10',
    });
    const sell = sellFour(f);

    expect(getAccountBalance(f.bankId)).toBe(rupees(94_650));
    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding).toMatchObject({
      status: 'priced',
      quantityMinor: shares('6'),
      costBasisMinor: rupees(6_060),
      averageUnitCostMinor: rupees(1_010),
      realizedGainMinor: rupees(710),
      marketValueMinor: rupees(7_200),
      unrealizedGainMinor: rupees(1_140),
    });
    expect(linkedTransaction(sell.id)).toMatchObject({
      type: 'investment_return',
      amount_minor: rupees(4_750),
      source_account_id: null,
      destination_account_id: f.bankId,
    });
  });

  it('pays a dividend of 500 into Bank as Investment Return income', () => {
    const f = fixture();
    buyTen(f);
    const before = septemberReport();

    const dividend = investments.recordDividend({
      assetId: f.assetId,
      accountId: f.bankId,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });

    expect(getAccountBalance(f.bankId)).toBe(rupees(90_400));
    expect(septemberReport().incomeMinor).toBe(before.incomeMinor + rupees(500));
    const cash = linkedTransaction(dividend.id);
    expect(cash.type).toBe('income');
    expect(cash.category_id).toBe(incomeCategory('Investment Return').id);
    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding.dividendsMinor).toBe(rupees(500));
    // Neither quantity nor basis moved.
    expect(holding.quantityMinor).toBe(shares('10'));
    expect(holding.costBasisMinor).toBe(rupees(10_100));
  });

  it('charges a standalone fee from Bank without creating an expense', () => {
    const f = fixture();
    buyTen(f);
    const before = septemberReport();

    const fee = investments.recordFee({
      assetId: f.assetId,
      accountId: f.bankId,
      amountMinor: rupees(25),
      tradeDate: september(21),
    });

    expect(getAccountBalance(f.bankId)).toBe(rupees(89_875));
    expect(linkedTransaction(fee.id)).toMatchObject({
      type: 'investment',
      amount_minor: rupees(25),
    });
    expect(septemberReport()).toEqual(before);
    expect(portfolio.getHolding(f.assetId, AS_OF).otherFeesMinor).toBe(rupees(25));
  });
});

describe('what investment capital flows never touch', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('leaves Income, Expense, Savings and budgets exactly where they were', () => {
    const f = fixture();
    const food = expenseCategory('Food');
    transactionService.createExpense({
      accountId: f.bankId,
      categoryId: food.id,
      amountMinor: rupees(2_000),
      transactionDate: september(3),
    });
    budgetService.createBudget({
      categoryId: food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    const report = septemberReport();
    const budget = budgetService.getMonthlyBudgetSummary('2026-09');

    buyTen(f);
    sellFour(f);
    investments.recordFee({
      assetId: f.assetId,
      accountId: f.bankId,
      amountMinor: rupees(10),
      tradeDate: september(16),
    });

    // Selling 4,800 of shares is not income, and buying 10,100 is not an expense.
    expect(septemberReport()).toEqual(report);
    expect(budgetService.getMonthlyBudgetSummary('2026-09')).toEqual(budget);
  });

  it('keeps Home’s Total Balance to cash, and its savings to income minus expense', () => {
    const f = fixture();
    buyTen(f);
    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(5_000),
      priceDate: '2026-09-10',
    });

    const home = getDashboardSummary({ now: september(20) });
    // The shares are worth 50,000, and none of that is in Total Balance.
    expect(home.totalBalanceMinor).toBe(rupees(89_900));
    expect(home.monthlySavingsMinor).toBe(home.monthlyIncomeMinor - home.monthlyExpenseMinor);
  });

  it('moves no receivable or liability', () => {
    const f = fixture();
    const ram = makePerson('Ram');
    transactionService.createLend({
      personId: ram.id,
      accountId: f.bankId,
      amountMinor: rupees(3_000),
      transactionDate: september(2),
    });
    const people = transactionService.getPeopleFinancialSummary();

    buyTen(f);
    sellFour(f);

    expect(transactionService.getPeopleFinancialSummary()).toEqual(people);
  });

  it('creates and changes no recurring template or occurrence', () => {
    const f = fixture();
    buyTen(f);
    sellFour(f);
    expect(count('recurring_templates')).toBe(0);
    expect(count('recurring_occurrences')).toBe(0);
    expect(recurringService.listRecurringTemplates()).toEqual([]);
  });
});

describe('refusals', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  function unchanged(f: Fixture) {
    return {
      trades: count('investment_trades'),
      transactions: count('transactions'),
      pending: countPendingSyncMutations(),
      balance: getAccountBalance(f.bankId),
    };
  }

  it('refuses to sell more than is held, and writes nothing', () => {
    const f = fixture();
    buyTen(f);
    const before = unchanged(f);

    expect(() =>
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('10.00000001'),
        unitPriceMinor: rupees(1_000),
        tradeDate: september(15),
      }),
    ).toThrow(ValidationError);
    expect(unchanged(f)).toEqual(before);
  });

  it('refuses a sale before the shares were bought', () => {
    const f = fixture();
    buyTen(f);
    expect(() =>
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('1'),
        unitPriceMinor: rupees(1_000),
        tradeDate: new Date(2026, 7, 31),
      }),
    ).toThrow(ValidationError);
  });

  it('never converts: the account must hold the asset’s currency', () => {
    const f = fixture();
    const dollars = makeAccount('Dollars', 'USD', rupees(1_000));
    expect(() =>
      investments.buyAsset({
        assetId: f.assetId,
        accountId: dollars.id,
        quantityMinor: shares('1'),
        unitPriceMinor: rupees(10),
        tradeDate: september(1),
      }),
    ).toThrow(/NPR/);
  });

  it('refuses archived assets and archived accounts for new trades', () => {
    const f = fixture();
    investments.archiveAsset(f.assetId);
    expect(() => buyTen(f)).toThrow(ValidationError);
    investments.unarchiveAsset(f.assetId);
    accountService.archiveAccount(f.bankId);
    expect(() => buyTen(f)).toThrow(ValidationError);
  });

  it('refuses a sale whose fee swallows the proceeds, and a purchase worth nothing', () => {
    const f = fixture();
    buyTen(f);
    expect(() =>
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('1'),
        unitPriceMinor: rupees(10),
        feeMinor: rupees(10),
        tradeDate: september(2),
      }),
    ).toThrow(/fee/i);
    expect(() =>
      investments.buyAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: 1,
        unitPriceMinor: 1,
        tradeDate: september(2),
      }),
    ).toThrow(/minor unit/);
  });

  it('refuses unsafe money and malformed quantities before anything is written', () => {
    const f = fixture();
    for (const quantityMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        investments.buyAsset({
          assetId: f.assetId,
          accountId: f.bankId,
          quantityMinor,
          unitPriceMinor: rupees(1),
          tradeDate: september(1),
        }),
      ).toThrow(ValidationError);
    }
    expect(() =>
      investments.buyAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('90000000'),
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        tradeDate: september(1),
      }),
    ).toThrow(/too large/);
    expect(count('investment_trades')).toBe(0);
  });

  it('freezes an asset’s currency once it has trades or prices', () => {
    const f = fixture();
    expect(investments.updateAsset(f.assetId, { currency: 'INR' }).currency).toBe('INR');
    investments.updateAsset(f.assetId, { currency: 'NPR' });
    investments.addPrice({ assetId: f.assetId, priceMinor: rupees(10), priceDate: '2026-09-01' });
    expect(() => investments.updateAsset(f.assetId, { currency: 'INR' })).toThrow(ValidationError);
  });

  it('keeps an account’s currency frozen once it has investment cash', () => {
    const f = fixture();
    buyTen(f);
    expect(() => accountService.updateAccount(f.bankId, { currency: 'USD' })).toThrow(
      ValidationError,
    );
  });
});

describe('editing and deleting history', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('accepts a backdated buy that makes a later sale possible', () => {
    const f = fixture();
    investments.buyAsset({
      assetId: f.assetId,
      accountId: f.bankId,
      quantityMinor: shares('5'),
      unitPriceMinor: rupees(1_000),
      tradeDate: september(10),
    });
    const sellEight = () =>
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('8'),
        unitPriceMinor: rupees(1_100),
        tradeDate: september(12),
      });
    expect(sellEight).toThrow(ValidationError);

    investments.buyAsset({
      assetId: f.assetId,
      accountId: f.bankId,
      quantityMinor: shares('5'),
      unitPriceMinor: rupees(900),
      tradeDate: september(1),
    });
    expect(() => sellEight()).not.toThrow();
    expect(portfolio.getHolding(f.assetId, AS_OF).quantityMinor).toBe(shares('2'));
  });

  it('refuses to delete a buy a later sale depends on, and allows it once the sale is gone', () => {
    const f = fixture();
    const buy = buyTen(f);
    const sell = sellFour(f);

    expect(() => investments.deleteTrade(buy.id)).toThrow(ValidationError);
    expect(linkedTransaction(buy.id).deleted_at).toBeNull();

    investments.deleteTrade(sell.id);
    investments.deleteTrade(buy.id);

    // Trade and cash tombstoned together, and the balance back where it began.
    expect(count('investment_trades', 'deleted_at IS NULL')).toBe(0);
    expect(linkedTransaction(buy.id).deleted_at).not.toBeNull();
    expect(linkedTransaction(sell.id).deleted_at).not.toBeNull();
    expect(getAccountBalance(f.bankId)).toBe(rupees(100_000));
    expect(portfolio.getHolding(f.assetId, AS_OF).status).toBe('closed');
    expect(() => investments.getTrade(buy.id)).toThrow(NotFoundError);
  });

  it('refuses an edit that leaves a later sale unsupported, and applies one that does not', () => {
    const f = fixture();
    const buy = buyTen(f);
    sellFour(f);

    expect(() => investments.updateTrade(buy.id, { quantityMinor: shares('3') })).toThrow(
      ValidationError,
    );
    expect(portfolio.getHolding(f.assetId, AS_OF).quantityMinor).toBe(shares('6'));

    investments.updateTrade(buy.id, { quantityMinor: shares('12'), feeMinor: rupees(120) });
    // 12 at 1,000 plus 120: the cash transaction moved with the trade.
    expect(linkedTransaction(buy.id).amount_minor).toBe(rupees(12_120));
    expect(getAccountBalance(f.bankId)).toBe(rupees(100_000 - 12_120 + 4_750));
    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding.quantityMinor).toBe(shares('8'));
    // 12,120 × 8/12.
    expect(holding.costBasisMinor).toBe(rupees(8_080));
  });

  it('refuses moving a sale to before its shares existed', () => {
    const f = fixture();
    buyTen(f);
    const sell = sellFour(f);
    expect(() => investments.updateTrade(sell.id, { tradeDate: new Date(2026, 7, 20) })).toThrow(
      ValidationError,
    );
  });

  it('never changes a trade’s kind: a dividend has no quantity, a sale no amount', () => {
    const f = fixture();
    buyTen(f);
    const sell = sellFour(f);
    const dividend = investments.recordDividend({
      assetId: f.assetId,
      accountId: f.bankId,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });
    expect(() => investments.updateTrade(sell.id, { amountMinor: rupees(1) })).toThrow(
      ValidationError,
    );
    expect(() => investments.updateTrade(dividend.id, { quantityMinor: 1 })).toThrow(
      ValidationError,
    );
    investments.updateTrade(dividend.id, { amountMinor: rupees(650) });
    expect(linkedTransaction(dividend.id).amount_minor).toBe(rupees(650));
  });

  it('replays trades entered on the same date in the order they were entered', () => {
    const f = fixture();
    const day = september(5);
    investments.buyAsset({
      assetId: f.assetId,
      accountId: f.bankId,
      quantityMinor: shares('5'),
      unitPriceMinor: rupees(1_000),
      tradeDate: day,
    });
    // Recorded immediately after, on the same date: it must follow the buy.
    for (let index = 0; index < 5; index += 1) {
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('1'),
        unitPriceMinor: rupees(1_000),
        tradeDate: day,
      });
    }
    expect(portfolio.getHolding(f.assetId, AS_OF).status).toBe('closed');
  });
});

describe('a trade and its cash', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('commit together or not at all', () => {
    const f = fixture();
    const before = {
      trades: count('investment_trades'),
      pending: countPendingSyncMutations(),
      balance: getAccountBalance(f.bankId),
    };
    rawClient().exec(`CREATE TRIGGER refuse_investment_cash BEFORE INSERT ON transactions
      WHEN NEW.investment_trade_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;`);

    expect(() => buyTen(f)).toThrow();

    expect({
      trades: count('investment_trades'),
      pending: countPendingSyncMutations(),
      balance: getAccountBalance(f.bankId),
    }).toEqual(before);
    rawClient().exec('DROP TRIGGER refuse_investment_cash');
  });

  it('change together or not at all', () => {
    const f = fixture();
    const buy = buyTen(f);
    rawClient().exec(`CREATE TRIGGER refuse_investment_cash_update BEFORE UPDATE ON transactions
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;`);

    expect(() => investments.updateTrade(buy.id, { quantityMinor: shares('11') })).toThrow();

    expect(investments.getTrade(buy.id).quantityMinor).toBe(shares('10'));
    rawClient().exec('DROP TRIGGER refuse_investment_cash_update');
  });

  it('counts the cash exactly once in the account balance', () => {
    const f = fixture();
    buyTen(f);
    sellFour(f);
    // Two trades carry gross, fee and quantity; the balance reads only the two
    // cash rows, 10,100 out and 4,750 in.
    expect(getAccountBalance(f.bankId)).toBe(rupees(100_000 - 10_100 + 4_750));
    expect(count('transactions', 'investment_trade_id IS NOT NULL AND deleted_at IS NULL')).toBe(2);
  });

  it('cannot be edited or deleted as an ordinary transaction', () => {
    const f = fixture();
    const buy = buyTen(f);
    const dividend = investments.recordDividend({
      assetId: f.assetId,
      accountId: f.bankId,
      amountMinor: rupees(500),
      tradeDate: september(20),
    });

    expect(() => transactionService.deleteTransaction(linkedTransaction(buy.id).id)).toThrow(
      /investment trade/,
    );
    expect(() =>
      transactionService.updateIncome(linkedTransaction(dividend.id).id, { amountMinor: 1 }),
    ).toThrow(/investment trade/);
    expect(() => transactionService.deleteTransaction(linkedTransaction(dividend.id).id)).toThrow(
      /investment trade/,
    );
    // Listing ordinary transactions still works with investment cash present.
    expect(transactionService.listTransactions().map((row) => row.type)).toEqual(
      expect.arrayContaining(['investment', 'income']),
    );
  });
});

describe('valuation', () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it('uses the latest price on or before the day asked about', () => {
    const f = fixture();
    buyTen(f);
    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(1_100),
      priceDate: '2026-09-01',
    });
    const later = investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(1_300),
      priceDate: '2026-09-10',
    });
    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(9_999),
      priceDate: '2026-10-05',
    });

    expect(portfolio.getHolding(f.assetId, AS_OF).marketValueMinor).toBe(rupees(13_000));
    expect(portfolio.getHolding(f.assetId, { asOf: new Date(2026, 8, 5) }).marketValueMinor).toBe(
      rupees(11_000),
    );

    investments.updatePrice(later.id, { priceMinor: rupees(1_250) });
    expect(portfolio.getHolding(f.assetId, AS_OF).marketValueMinor).toBe(rupees(12_500));

    investments.deletePrice(later.id);
    expect(portfolio.getHolding(f.assetId, AS_OF).marketValueMinor).toBe(rupees(11_000));
    expect(portfolio.getHolding(f.assetId, { asOf: new Date(2026, 7, 1) }).status).toBe('unpriced');
  });

  it('values a closed position at zero, because nothing is held', () => {
    const f = fixture();
    buyTen(f);
    investments.sellAsset({
      assetId: f.assetId,
      accountId: f.bankId,
      quantityMinor: shares('10'),
      unitPriceMinor: rupees(1_000),
      tradeDate: september(20),
    });
    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding).toMatchObject({
      status: 'closed',
      quantityMinor: 0,
      costBasisMinor: 0,
      marketValueMinor: 0,
      realizedGainMinor: rupees(-100),
    });
  });

  it('keeps currencies apart, and an unpriced position makes only its own total unknown', () => {
    const f = fixture();
    const dollars = makeAccount('Dollars', 'USD', rupees(10_000));
    const fund = investments.createAsset({ name: 'US Fund', assetType: 'etf', currency: 'USD' });
    buyTen(f);
    investments.addPrice({
      assetId: f.assetId,
      priceMinor: rupees(1_200),
      priceDate: '2026-09-10',
    });
    investments.buyAsset({
      assetId: fund.id,
      accountId: dollars.id,
      quantityMinor: shares('2.5'),
      unitPriceMinor: rupees(100),
      feeMinor: rupees(1),
      tradeDate: september(3),
    });

    const summary = portfolio.getPortfolioSummary(AS_OF);
    expect(summary.currencies.map((row) => row.currency)).toEqual(['NPR', 'USD']);
    const [npr, usd] = summary.currencies;
    expect(npr).toMatchObject({
      marketValueMinor: rupees(12_000),
      costBasisMinor: rupees(10_100),
      unrealizedGainMinor: rupees(1_900),
      unpricedPositionCount: 0,
    });
    // The fund has no price: its value is unknown, and never zero.
    expect(usd).toMatchObject({
      costBasisMinor: rupees(251),
      marketValueMinor: null,
      unrealizedGainMinor: null,
      pricedMarketValueMinor: 0,
      unpricedPositionCount: 1,
    });
  });

  it('reports a history that cannot be replayed as invalid, and counts it nowhere', () => {
    const f = fixture();
    buyTen(f);
    // Only a corrupted database can hold this: a sale the service would refuse.
    rawClient()
      .prepare(
        `INSERT INTO investment_trades (asset_id, account_id, trade_type, trade_date, quantity_minor, unit_price_minor, fee_minor, currency, created_at, updated_at, sync_id)
         VALUES (?, ?, 'sell', ?, ?, ?, 0, 'NPR', ?, ?, ?)`,
      )
      .run(
        f.assetId,
        f.bankId,
        september(20).getTime(),
        shares('11'),
        rupees(1_000),
        Date.now(),
        Date.now(),
        '11111111-1111-4111-8111-111111111111',
      );

    const holding = portfolio.getHolding(f.assetId, AS_OF);
    expect(holding.status).toBe('invalid');
    expect(holding.marketValueMinor).toBeNull();
    const summary = portfolio.getPortfolioSummary(AS_OF);
    expect(summary.invalidAssetIds).toEqual([f.assetId]);
    expect(summary.currencies).toEqual([]);
  });
});
