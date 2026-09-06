import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountRepository = vi.hoisted(() => ({ getAccountById: vi.fn() }));
const categoryRepository = vi.hoisted(() => ({ getCategoryById: vi.fn() }));
const peopleService = vi.hoisted(() => ({ getPerson: vi.fn() }));
const transactionRepository = vi.hoisted(() => ({
  createTransaction: vi.fn((record) => ({ id: 1, ...record })),
  deleteTransaction: vi.fn(),
  getPeopleDebtTotals: vi.fn(() => []),
  getPersonDebtCurrencies: vi.fn(() => []),
  getPersonDebtTotals: vi.fn(() => ({
    lentMinor: 0,
    borrowedMinor: 0,
    repaymentsReceivedMinor: 0,
    repaymentsPaidMinor: 0,
  })),
  getPersonTransactionItems: vi.fn(() => []),
  getTransactionById: vi.fn(),
  getTransactionViewById: vi.fn(),
  getTransactions: vi.fn(() => []),
  getTransactionViews: vi.fn(() => []),
  updateTransaction: vi.fn(),
}));

vi.mock('@/features/accounts/account.repository', () => accountRepository);
vi.mock('@/features/categories/category.repository', () => categoryRepository);
vi.mock('@/features/people/person.service', () => peopleService);
vi.mock('@/features/transactions/transaction.repository', () => transactionRepository);

import {
  createExpense,
  createLend,
  createRepaymentReceived,
  createTransfer,
  updateLend,
} from '@/features/transactions/transaction.service';

const cash = { id: 1, currency: 'NPR', isArchived: false };
const bank = { id: 2, currency: 'NPR', isArchived: false };

describe('financial transaction service safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountRepository.getAccountById.mockImplementation((id: number) =>
      id === 1 ? cash : id === 2 ? bank : null,
    );
    categoryRepository.getCategoryById.mockImplementation((id: number) =>
      id === 1 ? { id, type: 'expense' } : id === 2 ? { id, type: 'income' } : null,
    );
    peopleService.getPerson.mockReturnValue({ id: 1, isArchived: false });
    transactionRepository.getPersonDebtCurrencies.mockReturnValue([]);
    transactionRepository.getPersonDebtTotals.mockReturnValue({
      lentMinor: 0,
      borrowedMinor: 0,
      repaymentsReceivedMinor: 0,
      repaymentsPaidMinor: 0,
    });
  });

  it('creates an expense in exact minor units with its source account and matching category', () => {
    createExpense({
      accountId: 1,
      categoryId: 1,
      amountMinor: 500,
      paymentMode: 'cash',
      title: 'Lunch',
      transactionDate: new Date(2024, 8, 1),
    });

    expect(transactionRepository.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'expense',
        amountMinor: 500,
        sourceAccountId: 1,
        destinationAccountId: null,
        categoryId: 1,
        currency: 'NPR',
      }),
    );
  });

  it('rejects an income category for an expense before any database mutation', () => {
    expect(() =>
      createExpense({
        accountId: 1,
        categoryId: 2,
        amountMinor: 500,
        paymentMode: 'cash',
        title: 'Lunch',
        transactionDate: new Date(2024, 8, 1),
      }),
    ).toThrow('Expense transactions require an expense category.');
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('rejects unsafe transaction amounts before any database mutation', () => {
    expect(() =>
      createExpense({
        accountId: 1,
        categoryId: 1,
        amountMinor: Number.MAX_SAFE_INTEGER + 1,
        paymentMode: 'cash',
        title: 'Unsafe',
        transactionDate: new Date(2024, 8, 1),
      }),
    ).toThrow('Amount must be a positive integer');
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('rejects same-account and cross-currency transfers', () => {
    expect(() =>
      createTransfer({ sourceAccountId: 1, destinationAccountId: 1, amountMinor: 500, transactionDate: new Date() }),
    ).toThrow('different');

    accountRepository.getAccountById.mockImplementation((id: number) =>
      id === 1 ? cash : id === 2 ? { ...bank, currency: 'USD' } : null,
    );
    expect(() =>
      createTransfer({ sourceAccountId: 1, destinationAccountId: 2, amountMinor: 500, transactionDate: new Date() }),
    ).toThrow('different currencies');
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('rejects archived accounts for new transactions while preserving historical reads', () => {
    accountRepository.getAccountById.mockReturnValue({ ...cash, isArchived: true });
    expect(() =>
      createExpense({
        accountId: 1,
        categoryId: 1,
        amountMinor: 500,
        paymentMode: 'cash',
        title: 'Lunch',
        transactionDate: new Date(),
      }),
    ).toThrow('active account');
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('rejects repayments that exceed an existing receivable without mutation', () => {
    transactionRepository.getPersonDebtTotals.mockReturnValue({
      lentMinor: 600,
      borrowedMinor: 0,
      repaymentsReceivedMinor: 0,
      repaymentsPaidMinor: 0,
    });
    expect(() =>
      createRepaymentReceived({ personId: 1, accountId: 1, amountMinor: 700, transactionDate: new Date() }),
    ).toThrow('cannot exceed money lent');
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('rejects reducing a lend below recorded repayments', () => {
    transactionRepository.getTransactionById.mockReturnValue({
      id: 10,
      type: 'lend',
      personId: 1,
      sourceAccountId: 1,
      destinationAccountId: null,
      amountMinor: 1000,
      currency: 'NPR',
    });
    transactionRepository.getPersonDebtTotals.mockReturnValue({
      lentMinor: 0,
      borrowedMinor: 0,
      repaymentsReceivedMinor: 800,
      repaymentsPaidMinor: 0,
    });

    expect(() => updateLend(10, { amountMinor: 500 })).toThrow('cannot exceed money lent');
    expect(transactionRepository.updateTransaction).not.toHaveBeenCalled();
  });

  it('creates lending as a non-expense financial movement', () => {
    createLend({ personId: 1, accountId: 1, amountMinor: 1000, transactionDate: new Date() });
    expect(transactionRepository.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lend', categoryId: null, sourceAccountId: 1 }),
    );
  });
});
