import { describe, expect, it } from 'vitest';

import { groupTransactionsByDay } from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';

function view(
  id: number,
  type: TransactionView['type'],
  amountMinor: number,
  transactionDate: Date,
): TransactionView {
  return {
    id,
    type,
    amountMinor,
    currency: 'NPR',
    transactionDate,
    categoryId: null,
    categoryName: null,
    categoryIcon: null,
    personId: null,
    personName: null,
    accountId: 1,
    accountName: 'Cash',
    accountIcon: null,
    accountType: 'cash',
    sourceAccountId: null,
    destinationAccountId: null,
    sourceAccountName: null,
    destinationAccountName: null,
    paymentMode: null,
    title: null,
    note: null,
    createdAt: transactionDate,
    updatedAt: transactionDate,
  } as unknown as TransactionView;
}

const day1 = new Date(2026, 2, 5, 9, 0);
const day1Later = new Date(2026, 2, 5, 21, 30);
const day2 = new Date(2026, 2, 4, 12, 0);

describe('grouping transactions by day', () => {
  it('collects a calendar day into one group regardless of time of day', () => {
    const groups = groupTransactionsByDay([
      view(1, 'expense', 4250_00, day1),
      view(2, 'expense', 3000_00, day1Later),
      view(3, 'income', 185000_00, day2),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.transactions.map((item) => item.id)).toEqual([1, 2]);
    expect(groups[1]?.transactions.map((item) => item.id)).toEqual([3]);
  });

  it('preserves the order the query returned rather than re-sorting', () => {
    const groups = groupTransactionsByDay([
      view(1, 'expense', 100, day2),
      view(2, 'expense', 100, day1),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['2026-03-04', '2026-03-05']);
  });

  it('signs the day total by direction', () => {
    const groups = groupTransactionsByDay([
      view(1, 'expense', 4250_00, day1),
      view(2, 'income', 1000_00, day1),
    ]);

    expect(groups[0]?.netMinor).toBe(-3250_00);
  });

  it('treats lending as money out and repayment received as money in', () => {
    const groups = groupTransactionsByDay([
      view(1, 'lend', 25000_00, day1),
      view(2, 'repayment_received', 5000_00, day1),
    ]);

    expect(groups[0]?.netMinor).toBe(-20000_00);
  });

  it('leaves a transfer out of the day total', () => {
    const groups = groupTransactionsByDay([
      view(1, 'transfer', 50000_00, day1),
      view(2, 'income', 185000_00, day1),
    ]);

    expect(groups[0]?.netMinor).toBe(185000_00);
  });

  it('returns nothing for an empty list', () => {
    expect(groupTransactionsByDay([])).toEqual([]);
  });
});
