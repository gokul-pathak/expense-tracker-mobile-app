import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import { createBackup, restoreBackup } from '@/features/backup/backup.service';
import type { BackupEnvelope } from '@/features/backup/backup.types';
import { validateBackup } from '@/features/backup/backup.validation';
import { parseQuantity } from '@/features/investments/investment-math';
import * as investments from '@/features/investments/investment.service';
import * as portfolio from '@/features/investments/portfolio.service';
import { getReportRange, getReportSummary } from '@/features/reports/reports.service';
import { ValidationError } from '@/features/shared/errors';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory } from '../recurring/fixture';
import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * Investments in the backup file.
 *
 * A backup carries source records — assets, trades, manual prices and the link
 * from each trade's cash to the trade — and nothing derived. Restoring it must
 * reproduce every holding, value and balance exactly, and a file that could not
 * have been produced by the app must be refused before the database is touched.
 */

const rupees = (amount: number) => Math.round(amount * 100);
const shares = (text: string) => parseQuantity(text);
const september = (day: number) => new Date(2026, 8, day);
const AS_OF = { asOf: new Date(2026, 8, 30, 12) };

function fixture() {
  const bank = makeAccount('Bank', 'NPR', rupees(100_000));
  const asset = investments.createAsset({
    name: 'ABC Shares',
    symbol: 'ABC',
    assetType: 'stock',
    currency: 'NPR',
  });
  investments.buyAsset({
    assetId: asset.id,
    accountId: bank.id,
    quantityMinor: shares('10'),
    unitPriceMinor: rupees(1_000),
    feeMinor: rupees(100),
    tradeDate: september(1),
  });
  investments.addPrice({ assetId: asset.id, priceMinor: rupees(1_200), priceDate: '2026-09-10' });
  investments.sellAsset({
    assetId: asset.id,
    accountId: bank.id,
    quantityMinor: shares('4'),
    unitPriceMinor: rupees(1_200),
    feeMinor: rupees(50),
    tradeDate: september(15),
  });
  investments.recordDividend({
    assetId: asset.id,
    accountId: bank.id,
    amountMinor: rupees(500),
    tradeDate: september(20),
  });
  investments.recordFee({
    assetId: asset.id,
    accountId: bank.id,
    amountMinor: rupees(25),
    tradeDate: september(21),
  });
  return { bank, asset };
}

function figures() {
  return {
    holdings: portfolio.listHoldings(AS_OF),
    summary: portfolio.getPortfolioSummary(AS_OF),
    balances: accountService
      .listAccounts()
      .map((account) => [account.syncId, getAccountBalance(account.id)]),
    report: getReportSummary(getReportRange('this_month', september(20))),
  };
}

function count(table: string): number {
  return Number(
    (rawClient().prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number })
      .total,
  );
}

describe('investments in a backup', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('carries assets, trades, prices and cash links, and nothing derived', () => {
    fixture();
    const backup = createBackup();

    expect(backup.formatVersion).toBe(5);
    expect(backup.data.investmentAssets).toHaveLength(1);
    expect(backup.data.investmentTrades).toHaveLength(4);
    expect(backup.data.investmentPrices).toHaveLength(1);
    expect(backup.data.transactions.filter((tx) => tx.investmentTradeId !== null)).toHaveLength(4);
    const text = JSON.stringify(backup);
    for (const derived of [
      'costBasis',
      'marketValue',
      'realizedGain',
      'unrealizedGain',
      'averageUnitCost',
    ]) {
      expect(text).not.toContain(derived);
    }
  });

  it('restores identical holdings, values, reports and balances, keeping every identity', async () => {
    fixture();
    const before = figures();
    const backup = createBackup();

    await setupDatabase();
    restoreBackup(backup);

    expect(figures()).toEqual(before);
    expect(investments.listAssets().map((asset) => asset.syncId)).toEqual(
      backup.data.investmentAssets.map((asset) => asset.syncId),
    );
    // A restore is not a user mutation.
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('restores a backup written before investments existed, with none', async () => {
    const cash = makeAccount('Cash', 'NPR', rupees(1_000));
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory('Food').id,
      amountMinor: rupees(10),
      transactionDate: september(2),
    });
    const current = createBackup();
    const {
      investmentAssets: _assets,
      investmentTrades: _trades,
      investmentPrices: _prices,
      ...rest
    } = current.data;
    const older = {
      ...current,
      formatVersion: 4,
      schemaVersion: '20260911120000_recurring_transactions',
      data: {
        ...rest,
        transactions: rest.transactions.map(({ investmentTradeId: _link, ...tx }) => tx),
      },
    };

    await setupDatabase();
    fixture();
    restoreBackup(validateBackup(older));

    expect(investments.listAssets()).toEqual([]);
    expect(count('investment_trades')).toBe(0);
    expect(count('investment_prices')).toBe(0);
    expect(transactionService.listTransactions()).toHaveLength(1);
  });
});

describe('a backup that could not have been produced', () => {
  let valid: BackupEnvelope;

  beforeEach(async () => {
    await setupDatabase();
    fixture();
    valid = createBackup();
    await setupDatabase();
    makeAccount('Marker', 'NPR', 1);
  });

  const cases: [string, (backup: BackupEnvelope) => void][] = [
    ['a negative quantity', (b) => void (b.data.investmentTrades[0]!.quantityMinor = -1)],
    [
      'a trade type that does not exist',
      (b) => void ((b.data.investmentTrades[0] as { tradeType: string }).tradeType = 'short'),
    ],
    ['a trade whose asset is missing', (b) => void (b.data.investmentTrades[0]!.assetId = 999)],
    ['a trade whose account is missing', (b) => void (b.data.investmentTrades[0]!.accountId = 999)],
    [
      'money that cannot be represented exactly',
      (b) => void (b.data.investmentTrades[0]!.unitPriceMinor = Number.MAX_SAFE_INTEGER + 2),
    ],
    [
      'a duplicate sync identity',
      (b) => void (b.data.investmentTrades[1]!.syncId = b.data.investmentAssets[0]!.syncId),
    ],
    [
      'a history that sells more than it holds',
      (b) => {
        const sale = b.data.investmentTrades.find((trade) => trade.tradeType === 'sell')!;
        sale.quantityMinor = shares('11');
      },
    ],
    [
      'cash that does not match its trade',
      (b) => {
        const cash = b.data.transactions.find((tx) => tx.investmentTradeId !== null)!;
        cash.amountMinor += 1;
      },
    ],
    [
      'a trade with no cash',
      (b) => {
        const dividend = b.data.investmentTrades.find((trade) => trade.tradeType === 'dividend')!;
        b.data.transactions = b.data.transactions.filter(
          (tx) => tx.investmentTradeId !== dividend.id,
        );
      },
    ],
    [
      'investment cash without a trade',
      (b) => {
        const cash = b.data.transactions.find((tx) => tx.type === 'investment')!;
        cash.investmentTradeId = null;
      },
    ],
    ['a price in another currency', (b) => void (b.data.investmentPrices[0]!.currency = 'USD')],
  ];

  it.each(cases)('is refused for %s, before anything is written', (_name, tamper) => {
    const backup = structuredClone(valid);
    tamper(backup);

    expect(() => restoreBackup(backup)).toThrow(ValidationError);
    expect(accountService.listAccounts().map((account) => account.name)).toEqual(['Marker']);
    expect(count('investment_assets')).toBe(0);
  });
});
