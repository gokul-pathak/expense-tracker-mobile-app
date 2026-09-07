import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

const uuid = vi.hoisted(() => ({ broken: false }));
vi.mock('expo-crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../support/expo-crypto')>();
  return {
    ...actual,
    randomUUID: () => (uuid.broken ? 'not-a-valid-uuid' : actual.randomUUID()),
  };
});

import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  listPendingSyncMutations,
  removeAcknowledgedSyncMutation,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

const date = new Date(2026, 0, 15);

function countTransactions() {
  const row = rawClient().prepare('SELECT count(*) AS total FROM transactions').get();
  return Number((row as { total: unknown }).total);
}

/** Makes only outbox inserts fail, leaving every other write healthy. */
function breakOutboxWrites() {
  rawClient().exec(
    `CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON sync_outbox
     BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END;`,
  );
}

describe('domain mutation and outbox atomicity', () => {
  beforeEach(async () => {
    uuid.broken = false;
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('rolls the domain mutation back when the outbox write fails', () => {
    const cash = makeAccount();
    const category = expenseCategory();
    const before = countTransactions();
    breakOutboxWrites();

    expect(() =>
      transactionService.createExpense({
        accountId: cash.id,
        categoryId: category.id,
        amountMinor: 1200,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: date,
      }),
    ).toThrow(/sync_outbox/);

    // Neither half of the mutation may survive.
    expect(countTransactions()).toBe(before);
    expect(transactionService.listTransactions()).toHaveLength(before);
  });

  it('rolls an update back when the outbox write fails', () => {
    const cash = makeAccount();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1200,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: date,
    });
    removeAcknowledgedSyncMutation(listPendingSyncMutations().at(-1)!.id);
    breakOutboxWrites();

    expect(() => transactionService.updateExpense(expense.id, { amountMinor: 9900 })).toThrow(
      /sync_outbox/,
    );

    expect(transactionService.getTransaction(expense.id).amountMinor).toBe(1200);
    expect(getPendingSyncMutation('transaction', expense.syncId!)).toBeNull();
  });

  it('rolls a delete back when the outbox write fails', () => {
    const cash = makeAccount();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1200,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: date,
    });
    removeAcknowledgedSyncMutation(listPendingSyncMutations().at(-1)!.id);
    breakOutboxWrites();

    expect(() => transactionService.deleteTransaction(expense.id)).toThrow(/sync_outbox/);

    expect(transactionService.getTransaction(expense.id).deletedAt).toBeNull();
  });

  it('leaves no phantom cloud work when the domain mutation is rejected', () => {
    const cash = makeAccount();
    const before = countPendingSyncMutations();

    expect(() =>
      transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: -500,
        title: 'Invalid',
        paymentMode: 'cash',
        transactionDate: date,
      }),
    ).toThrow(/Amount must be a positive integer/);

    expect(countTransactions()).toBe(0);
    expect(countPendingSyncMutations()).toBe(before);
  });

  it('leaves the record and the queue untouched when an edit is rejected', () => {
    const cash = makeAccount();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1200,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: date,
    });
    // Simulate the record having already been pushed.
    removeAcknowledgedSyncMutation(listPendingSyncMutations().at(-1)!.id);

    expect(() => transactionService.updateExpense(expense.id, { amountMinor: 0 })).toThrow(
      /Amount must be a positive integer/,
    );

    expect(transactionService.getTransaction(expense.id).amountMinor).toBe(1200);
    expect(getPendingSyncMutation('transaction', expense.syncId!)).toBeNull();
  });

  it('refuses to commit a record without a valid global identity', () => {
    const cash = makeAccount();
    const category = expenseCategory();
    uuid.broken = true;

    expect(() =>
      transactionService.createExpense({
        accountId: cash.id,
        categoryId: category.id,
        amountMinor: 1200,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: date,
      }),
    ).toThrow(/Sync identity generation failed/);

    expect(countTransactions()).toBe(0);
    expect(countPendingSyncMutations()).toBe(1);
  });
});
