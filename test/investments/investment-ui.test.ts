import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import {
  InvestmentHistoryError,
  InvestmentValidationError,
} from '@/features/investments/investment.errors';
import { parseQuantity } from '@/features/investments/investment-math';
import * as present from '@/features/investments/investment-presentation';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import * as preview from '@/features/investments/trade-preview.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { ValidationError } from '@/features/shared/errors';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import { getTransactionLabel } from '@/features/transactions/transaction-presentation';
import * as transactionService from '@/features/transactions/transaction.service';

import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * What the investment screens show and do, against real SQLite.
 *
 * Each screen is a thin arrangement of one read model and the presentation
 * module, so this drives exactly that pair — `getPortfolioOverview` and
 * `getAssetDetail` for what is on screen, the preview service for what a form
 * shows before Record, the presentation module for every word. What is not
 * asserted is layout; every figure and sentence a screen depends on is.
 *
 * The milestone fixture: Bank opens at NPR 100,000; buy 10 ABC Shares at 1,000
 * with a fee of 100; price them at 1,200; sell 4 at 1,200 with a fee of 50.
 */

const rupees = (amount: number) => Math.round(amount * 100);
const dollars = rupees;
const shares = (text: string) => parseQuantity(text);
const september = (day: number) => new Date(2026, 8, day);
const AS_OF = { asOf: new Date(2026, 8, 30, 12) };

type Fixture = { bankId: number; assetId: number };

function fixture(): Fixture {
  const bank = makeAccount('Bank', 'NPR', rupees(100_000));
  const asset = investments.createAsset({
    name: 'ABC Shares',
    assetType: 'stock',
    currency: 'NPR',
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

function priceAt(f: Fixture, amount: number, priceDate = '2026-09-10') {
  return investments.addPrice({ assetId: f.assetId, priceMinor: rupees(amount), priceDate });
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

/** What the asset screen reads. */
function assetScreen(f: Fixture) {
  return portfolio.getAssetDetail(f.assetId, AS_OF);
}

/** What the portfolio screen reads, split into its three lists as it shows them. */
function portfolioScreen() {
  const overview = portfolio.getPortfolioOverview(AS_OF);
  return { ...overview, lists: present.partitionHoldings(overview.holdings) };
}

function septemberReport() {
  return getReportSummary(getReportRange('this_month', september(20)));
}

function home() {
  return getDashboardSummary({ now: september(20) });
}

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function refusalOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('investment screens', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  describe('portfolio', () => {
    it('has nothing to show before an investment exists, so Home shows no card', () => {
      makeAccount('Bank', 'NPR', rupees(100_000));
      const screen = portfolioScreen();
      expect(screen.holdings).toEqual([]);
      expect(screen.summary).toEqual({ currencies: [], invalidAssetIds: [] });
      expect(present.hasInvestmentData(portfolio.getPortfolioSummary(AS_OF))).toBe(false);
    });

    it('adds an asset that moves no money, creates no transaction and holds nothing', () => {
      const bank = makeAccount('Bank', 'NPR', rupees(100_000));
      const transactions = count('transactions');
      const pending = countPendingSyncMutations();

      const asset = investments.createAsset({
        name: 'ABC Shares',
        symbol: null,
        assetType: 'stock',
        currency: 'NPR',
      });

      expect(getAccountBalance(bank.id)).toBe(rupees(100_000));
      expect(count('transactions')).toBe(transactions);
      expect(countPendingSyncMutations()).toBe(pending + 1);
      const [row] = portfolioScreen().lists.holdings;
      expect(row).toMatchObject({ assetId: asset.id, quantityMinor: 0, tradeCount: 0 });
      expect(present.holdingDetailLine(row!)).toBe('No trades yet');
      expect(present.hasInvestmentData(portfolio.getPortfolioSummary(AS_OF))).toBe(true);
    });

    it('shows the milestone fixture after the sale exactly', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      sellFour(f);

      const { holding, history } = assetScreen(f);
      expect(getAccountBalance(f.bankId)).toBe(rupees(94_650));
      expect(holding).toMatchObject({
        quantityMinor: shares('6'),
        costBasisMinor: rupees(6_060),
        marketValueMinor: rupees(7_200),
        realizedGainMinor: rupees(710),
        unrealizedGainMinor: rupees(1_140),
      });
      expect(present.formatHoldingQuantity(holding.quantityMinor, 'stock', 'NPR')).toBe('6 shares');
      expect(present.presentGain(holding.unrealizedGainMinor!, 'NPR', 'unrealized').value).toBe(
        '+1,140.00',
      );
      expect(present.presentGain(holding.realizedGainMinor, 'NPR', 'realized').value).toBe(
        '+710.00',
      );
      expect(present.holdingAccessibilityLabel(holding)).toBe(
        'ABC Shares, 6 shares held, current value 7,200 rupees, unrealized gain 1,140 rupees.',
      );
      expect(history.map((trade) => trade.tradeType)).toEqual(['sell', 'buy']);
      expect(history.map((trade) => trade.cashEffect.amountMinor)).toEqual([
        rupees(4_750),
        rupees(10_100),
      ]);

      // The portfolio screen's row is the same holding, read in the same replay.
      expect(portfolioScreen().lists.holdings[0]).toMatchObject({
        assetId: f.assetId,
        marketValueMinor: rupees(7_200),
        unrealizedGainMinor: rupees(1_140),
      });
    });

    it('orders holdings by current value, then unpriced ones by name, with archived ones apart', () => {
      const bank = makeAccount('Bank', 'NPR', rupees(1_000_000));
      const hold = (name: string, quantity: string, price: number | null) => {
        const asset = investments.createAsset({ name, assetType: 'stock', currency: 'NPR' });
        investments.buyAsset({
          assetId: asset.id,
          accountId: bank.id,
          quantityMinor: shares(quantity),
          unitPriceMinor: rupees(100),
          tradeDate: september(1),
        });
        if (price !== null) {
          investments.addPrice({
            assetId: asset.id,
            priceMinor: rupees(price),
            priceDate: '2026-09-10',
          });
        }
        return asset;
      };
      hold('Small Co', '1', 150);
      hold('beta Fund', '3', null);
      hold('Large Co', '10', 150);
      hold('Alpha Fund', '3', null);
      investments.archiveAsset(hold('Old Co', '1', 500).id);

      const screen = portfolioScreen();
      expect(screen.lists.holdings.map((holding) => holding.name)).toEqual([
        'Large Co',
        'Small Co',
        'Alpha Fund',
        'beta Fund',
      ]);
      expect(screen.lists.archived.map((holding) => holding.name)).toEqual(['Old Co']);
      // An archived holding still counts: archiving hides it from new trades only.
      expect(screen.summary.currencies[0]?.assetCount).toBe(5);
    });

    it('shows an unpriced holding as unavailable, never zero, and still shows its cost basis', () => {
      const f = fixture();
      buyTen(f);

      const { holding } = assetScreen(f);
      expect(holding).toMatchObject({
        status: 'unpriced',
        marketValueMinor: null,
        unrealizedGainMinor: null,
        costBasisMinor: rupees(10_100),
      });
      const [npr] = portfolio.getPortfolioSummary(AS_OF).currencies;
      expect(npr).toMatchObject({ marketValueMinor: null, costBasisMinor: rupees(10_100) });
      expect(present.describeValueAvailability(npr!)).toBe(
        '1 holding has no current price, so the total value is unavailable.',
      );
      expect(present.holdingAccessibilityLabel(holding)).toBe(
        'ABC Shares, 10 shares held, current value unavailable.',
      );
    });

    it('keeps each currency’s portfolio apart and never adds them together', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      const dollarAccount = makeAccount('Dollar Account', 'USD', dollars(1_000));
      const fund = investments.createAsset({
        name: 'Global Fund',
        assetType: 'etf',
        currency: 'USD',
      });
      investments.buyAsset({
        assetId: fund.id,
        accountId: dollarAccount.id,
        quantityMinor: shares('2'),
        unitPriceMinor: dollars(250),
        tradeDate: september(2),
      });
      investments.addPrice({ assetId: fund.id, priceMinor: dollars(250), priceDate: '2026-09-10' });

      const { currencies } = portfolio.getPortfolioSummary(AS_OF);
      expect(currencies.map((summary) => [summary.currency, summary.marketValueMinor])).toEqual([
        ['NPR', rupees(12_000)],
        ['USD', dollars(500)],
      ]);
      expect(currencies.map((summary) => present.portfolioTitle(summary.currency))).toEqual([
        'NPR Portfolio',
        'USD Portfolio',
      ]);

      // No trade moves cash between currencies.
      const refusal = refusalOf(() =>
        investments.buyAsset({
          assetId: fund.id,
          accountId: f.bankId,
          quantityMinor: shares('1'),
          unitPriceMinor: dollars(250),
          tradeDate: september(3),
        }),
      );
      expect(refusal).toBeInstanceOf(InvestmentValidationError);
      expect((refusal as InvestmentValidationError).code).toBe('currency_mismatch');
    });

    it('gives Home the same summary the portfolio screen shows, in one call', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      sellFour(f);
      const summary = portfolio.getPortfolioSummary(AS_OF);
      expect(summary).toEqual(portfolio.getPortfolioOverview(AS_OF).summary);
      expect(present.hasInvestmentData(summary)).toBe(true);
    });
  });

  describe('buy', () => {
    it('previews a purchase exactly as the recorded trade turns out', () => {
      const f = fixture();
      expect(
        preview.previewBuy({
          quantityMinor: shares('10'),
          unitPriceMinor: rupees(1_000),
          feeMinor: rupees(100),
        }),
      ).toEqual({
        grossMinor: rupees(10_000),
        feeMinor: rupees(100),
        totalCashOutflowMinor: rupees(10_100),
      });

      const trade = buyTen(f);

      expect(getAccountBalance(f.bankId)).toBe(rupees(89_900));
      const { holding, history } = assetScreen(f);
      expect(holding).toMatchObject({
        quantityMinor: shares('10'),
        costBasisMinor: rupees(10_100),
      });
      expect(history[0]).toMatchObject({
        id: trade.id,
        accountName: 'Bank',
        cashEffect: { direction: 'out', amountMinor: rupees(10_100) },
      });
    });

    it('takes cash out of Total Balance and leaves Expense, Savings and Budgets alone', () => {
      const f = fixture();
      budgetService.createBudget({
        categoryId: null,
        periodMonth: '2026-09',
        amountMinor: rupees(40_000),
        currency: 'NPR',
      });
      const homeBefore = home();
      const reportBefore = septemberReport();
      const spentBefore =
        budgetService.getMonthlyBudgetSummary('2026-09').overallBudget?.spentMinor;

      buyTen(f);

      const homeAfter = home();
      expect(homeAfter).toMatchObject({
        monthlyIncomeMinor: homeBefore.monthlyIncomeMinor,
        monthlyExpenseMinor: homeBefore.monthlyExpenseMinor,
        monthlySavingsMinor: homeBefore.monthlySavingsMinor,
        totalBalanceMinor: homeBefore.totalBalanceMinor - rupees(10_100),
      });
      expect(septemberReport()).toEqual(reportBefore);
      expect(budgetService.getMonthlyBudgetSummary('2026-09').overallBudget?.spentMinor).toBe(
        spentBefore,
      );

      // Total Balance is cash in accounts. Pricing the shares adds nothing to it;
      // what they are worth is the portfolio's figure alone.
      priceAt(f, 1_200);
      expect(home().totalBalanceMinor).toBe(homeAfter.totalBalanceMinor);
      expect(portfolio.getPortfolioSummary(AS_OF).currencies[0]?.marketValueMinor).toBe(
        rupees(12_000),
      );
    });
  });

  describe('sell', () => {
    it('previews a sale and records exactly what it previewed', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);

      expect(preview.getSellableQuantity(f.assetId, september(15))).toBe(shares('10'));
      const sale = preview.previewSell({
        assetId: f.assetId,
        quantityMinor: shares('4'),
        unitPriceMinor: rupees(1_200),
        feeMinor: rupees(50),
        tradeDate: september(15),
      });
      expect(sale).toEqual({
        grossMinor: rupees(4_800),
        feeMinor: rupees(50),
        netCashReceivedMinor: rupees(4_750),
        realizedGainMinor: rupees(710),
        remainingQuantityMinor: shares('6'),
      });
      const homeBefore = home();
      const reportBefore = septemberReport();

      sellFour(f);

      const { holding } = assetScreen(f);
      expect(holding.realizedGainMinor).toBe(sale.realizedGainMinor);
      expect(holding.quantityMinor).toBe(sale.remainingQuantityMinor);
      expect(getAccountBalance(f.bankId)).toBe(rupees(94_650));
      // A sale is capital coming back, not income.
      expect(septemberReport()).toEqual(reportBefore);
      expect(home()).toMatchObject({
        monthlyIncomeMinor: homeBefore.monthlyIncomeMinor,
        monthlyExpenseMinor: homeBefore.monthlyExpenseMinor,
        totalBalanceMinor: homeBefore.totalBalanceMinor + rupees(4_750),
      });
    });

    it('refuses a sale larger than what is available, and records nothing', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      sellFour(f);

      const available = preview.getSellableQuantity(f.assetId, september(20));
      expect(present.availableLabel(available, 'stock', 'NPR')).toBe('Available: 6 shares');
      expect(present.sellQuantityError(shares('7'), available, 'stock', 'NPR')).toBe(
        'You can sell up to 6 shares on this date.',
      );
      expect(
        preview.previewSell({
          assetId: f.assetId,
          quantityMinor: shares('7'),
          unitPriceMinor: rupees(1_200),
          tradeDate: september(20),
        }),
      ).toMatchObject({ realizedGainMinor: null, remainingQuantityMinor: null });

      const trades = count('investment_trades');
      const pending = countPendingSyncMutations();
      const balance = getAccountBalance(f.bankId);
      const refusal = refusalOf(() =>
        investments.sellAsset({
          assetId: f.assetId,
          accountId: f.bankId,
          quantityMinor: shares('7'),
          unitPriceMinor: rupees(1_200),
          tradeDate: september(20),
        }),
      );

      expect(refusal).toBeInstanceOf(InvestmentHistoryError);
      expect(present.describeInvestmentError(refusal, 'sell')).toBe(
        'This sale is more than is available on that date, including what later sales need.',
      );
      expect(count('investment_trades')).toBe(trades);
      expect(countPendingSyncMutations()).toBe(pending);
      expect(getAccountBalance(f.bankId)).toBe(balance);
      expect(assetScreen(f).holding.quantityMinor).toBe(shares('6'));
    });

    it('limits a backdated sale to what was held then and what later sales still need', () => {
      const f = fixture();
      buyTen(f);
      sellFour(f);

      expect(preview.getSellableQuantity(f.assetId, new Date(2026, 7, 31))).toBe(0);
      // Ten were held on the 5th, but the sale on the 15th still needs four of them.
      expect(preview.getSellableQuantity(f.assetId, september(5))).toBe(shares('6'));

      // A backdated buy makes more available, and the holding replays at once.
      investments.buyAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('5'),
        unitPriceMinor: rupees(900),
        tradeDate: new Date(2026, 7, 25),
      });
      expect(preview.getSellableQuantity(f.assetId, september(5))).toBe(shares('11'));
      expect(assetScreen(f).holding.quantityMinor).toBe(shares('11'));
    });

    it('previews an edited sale without counting the sale being edited', () => {
      const f = fixture();
      buyTen(f);
      const sale = sellFour(f);
      expect(
        preview.getSellableQuantity(f.assetId, september(15), { replacingTradeId: sale.id }),
      ).toBe(shares('10'));
      expect(
        preview.previewSell({
          assetId: f.assetId,
          quantityMinor: shares('5'),
          unitPriceMinor: rupees(1_200),
          feeMinor: rupees(50),
          tradeDate: september(15),
          replacingTradeId: sale.id,
        }).remainingQuantityMinor,
      ).toBe(shares('5'));
    });

    it('keeps a sold-out asset, its realized gain and its history, without archiving it', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      investments.sellAsset({
        assetId: f.assetId,
        accountId: f.bankId,
        quantityMinor: shares('10'),
        unitPriceMinor: rupees(1_200),
        feeMinor: rupees(50),
        tradeDate: september(15),
      });

      const { holding, history } = assetScreen(f);
      expect(holding).toMatchObject({
        status: 'closed',
        quantityMinor: 0,
        isArchived: false,
        realizedGainMinor: rupees(12_000 - 50 - 10_100),
      });
      expect(history).toHaveLength(2);
      expect(present.holdingDetailLine(holding)).toBe('No current holdings');
      const screen = portfolioScreen();
      expect(screen.lists.holdings).toEqual([]);
      expect(screen.lists.closed.map((item) => item.assetId)).toEqual([f.assetId]);
    });
  });

  describe('dividend and price', () => {
    it('records a dividend as cash and as Investment Return income, exactly as M10A defines it', () => {
      const f = fixture();
      buyTen(f);
      const reportBefore = septemberReport();
      const holdingBefore = assetScreen(f).holding;

      const dividend = investments.recordDividend({
        assetId: f.assetId,
        accountId: f.bankId,
        amountMinor: rupees(500),
        tradeDate: september(20),
      });

      expect(getAccountBalance(f.bankId)).toBe(rupees(89_900 + 500));
      const report = septemberReport();
      expect(report.incomeMinor).toBe(reportBefore.incomeMinor + rupees(500));
      expect(report.expenseMinor).toBe(reportBefore.expenseMinor);
      expect(assetScreen(f).holding).toMatchObject({
        dividendsMinor: rupees(500),
        quantityMinor: holdingBefore.quantityMinor,
        costBasisMinor: holdingBefore.costBasisMinor,
      });

      const cash = transactionService
        .listTransactionViews()
        .find((view) => view.investmentTradeId === dividend.id);
      expect(cash).toMatchObject({ type: 'income', amountMinor: rupees(500) });
      expect(getTransactionLabel(cash!)).toBe(cash!.categoryName);
      expect(cash!.categoryName).toMatch(/Investment Return/);
      // Its income row changes only with the trade.
      expect(() => transactionService.deleteTransaction(cash!.id)).toThrow(ValidationError);
    });

    it('changes only the current value and unrealized gain when the price is updated', () => {
      const f = fixture();
      buyTen(f);
      priceAt(f, 1_200);
      sellFour(f);
      const before = assetScreen(f).holding;
      const balance = getAccountBalance(f.bankId);
      const transactions = count('transactions');
      const report = septemberReport();

      priceAt(f, 1_300, '2026-09-20');

      const after = assetScreen(f).holding;
      expect(getAccountBalance(f.bankId)).toBe(balance);
      expect(count('transactions')).toBe(transactions);
      expect(septemberReport()).toEqual(report);
      expect(after).toMatchObject({
        quantityMinor: before.quantityMinor,
        costBasisMinor: before.costBasisMinor,
        realizedGainMinor: before.realizedGainMinor,
        marketValueMinor: rupees(7_800),
        unrealizedGainMinor: rupees(1_740),
        latestPrice: { priceMinor: rupees(1_300), priceDate: '2026-09-20' },
      });
      expect(present.priceUpdatedLabel('2026-09-20', september(21))).toBe('Price updated Sep 20');

      // Editing the latest price in place does the same, and nothing else.
      const [latest] = assetScreen(f).recentPrices;
      investments.updatePrice(latest!.id, { priceMinor: rupees(1_100) });
      expect(assetScreen(f).holding).toMatchObject({
        marketValueMinor: rupees(6_600),
        unrealizedGainMinor: rupees(540),
      });
      expect(getAccountBalance(f.bankId)).toBe(balance);
    });
  });

  describe('history', () => {
    it('lists newest first, keeping trades from one day in the order they were entered', () => {
      const f = fixture();
      const buy = (quantity: string, day: number) =>
        investments.buyAsset({
          assetId: f.assetId,
          accountId: f.bankId,
          quantityMinor: shares(quantity),
          unitPriceMinor: rupees(1_000),
          tradeDate: september(day),
        });
      const first = buy('1', 3);
      const second = buy('2', 3);
      const earlier = buy('3', 1);

      const { history } = assetScreen(f);
      expect(history.map((trade) => trade.id)).toEqual([second.id, first.id, earlier.id]);
      // Each row's cash is its linked transaction's own amount.
      for (const trade of history) {
        const row = rawClient()
          .prepare(
            'SELECT amount_minor FROM transactions WHERE investment_trade_id = ? AND deleted_at IS NULL',
          )
          .get(trade.id) as { amount_minor: number };
        expect(trade.cashEffect.amountMinor).toBe(Number(row.amount_minor));
      }
    });

    it('refuses an unsafe edit or delete with a sentence, and changes nothing', () => {
      const f = fixture();
      const buy = buyTen(f);
      const sale = sellFour(f);
      const balance = getAccountBalance(f.bankId);
      const pending = countPendingSyncMutations();

      const deleted = refusalOf(() => investments.deleteTrade(buy.id));
      expect(deleted).toBeInstanceOf(InvestmentHistoryError);
      expect(present.describeInvestmentError(deleted, 'delete')).toBe(
        'This change would make later investment history invalid.',
      );
      const edited = refusalOf(() =>
        investments.updateTrade(buy.id, { quantityMinor: shares('3') }),
      );
      expect(present.describeInvestmentError(edited, 'edit')).toBe(
        'This change would make later investment history invalid.',
      );
      expect(assetScreen(f).history).toHaveLength(2);
      expect(getAccountBalance(f.bankId)).toBe(balance);
      expect(countPendingSyncMutations()).toBe(pending);

      // With the sale gone first, the buy can go too, and the cash comes back.
      investments.deleteTrade(sale.id);
      investments.deleteTrade(buy.id);
      expect(assetScreen(f).holding).toMatchObject({ quantityMinor: 0, tradeCount: 0 });
      expect(getAccountBalance(f.bankId)).toBe(rupees(100_000));
    });

    it('refuses a trade on an asset or through an account archived while the form was open', () => {
      const f = fixture();
      buyTen(f);
      const wallet = makeAccount('Old Wallet', 'NPR', 0);
      accountService.archiveAccount(wallet.id);

      const throughArchived = refusalOf(() =>
        investments.buyAsset({
          assetId: f.assetId,
          accountId: wallet.id,
          quantityMinor: shares('1'),
          unitPriceMinor: rupees(1_000),
          tradeDate: september(2),
        }),
      );
      expect(present.describeInvestmentError(throughArchived, 'buy')).toBe(
        'That account has been archived. Choose an active account.',
      );

      investments.archiveAsset(f.assetId);
      const onArchived = refusalOf(() =>
        investments.sellAsset({
          assetId: f.assetId,
          accountId: f.bankId,
          quantityMinor: shares('1'),
          unitPriceMinor: rupees(1_000),
          tradeDate: september(2),
        }),
      );
      expect(present.describeInvestmentError(onArchived, 'sell')).toBe(
        'This investment is archived. Unarchive it to record new trades.',
      );
      // The holding and its history are kept, under Archived.
      expect(portfolioScreen().lists.archived.map((item) => item.assetId)).toEqual([f.assetId]);
      expect(assetScreen(f).holding.quantityMinor).toBe(shares('10'));
    });

    it('keeps buy and sell cash out of the ordinary transaction list', () => {
      const f = fixture();
      buyTen(f);
      sellFour(f);
      const types = transactionService.listTransactionViews().map((view) => view.type);
      expect(types).not.toContain('investment');
      expect(types).not.toContain('investment_return');
    });
  });

  describe('with no network and no account', () => {
    it('records every investment action locally, visible at once and queued for sync', () => {
      const bank = makeAccount('Bank', 'NPR', rupees(100_000));
      let expected = countPendingSyncMutations();

      const asset = investments.createAsset({
        name: 'ABC Shares',
        assetType: 'stock',
        currency: 'NPR',
      });
      expected += 1;
      expect(countPendingSyncMutations()).toBe(expected);
      expect(portfolioScreen().holdings).toHaveLength(1);

      const f = { bankId: bank.id, assetId: asset.id };
      buyTen(f);
      expected += 2;
      expect(countPendingSyncMutations()).toBe(expected);
      expect(assetScreen(f).holding.quantityMinor).toBe(shares('10'));

      priceAt(f, 1_200);
      expected += 1;
      expect(countPendingSyncMutations()).toBe(expected);
      expect(assetScreen(f).holding.marketValueMinor).toBe(rupees(12_000));

      sellFour(f);
      expected += 2;
      expect(countPendingSyncMutations()).toBe(expected);
      expect(assetScreen(f).holding.quantityMinor).toBe(shares('6'));

      investments.recordDividend({
        assetId: asset.id,
        accountId: bank.id,
        amountMinor: rupees(500),
        tradeDate: september(20),
      });
      expected += 2;
      expect(countPendingSyncMutations()).toBe(expected);
      expect(assetScreen(f).holding.dividendsMinor).toBe(rupees(500));
    });
  });
});
