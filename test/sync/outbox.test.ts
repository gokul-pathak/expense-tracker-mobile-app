import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { SYNC_ENTITY_TYPES } from '@/db/schema';
import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as settingsService from '@/features/settings/settings.service';
import {
  countPendingSyncMutations,
  getPendingSyncMutation,
  listPendingSyncMutations,
  markSyncAttempt,
  removeAcknowledgedSyncMutation,
  updateSyncState,
} from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  expenseCategory,
  incomeCategory,
  makeAccount,
  makePerson,
  setupDatabase,
} from '../support/domain';
import {
  closeTestDatabase,
  migrateTestDatabase,
  reopenTestDatabase,
} from '../support/test-database';

const date = new Date(2026, 0, 15);

function pending() {
  return listPendingSyncMutations().map((entry) => ({
    entityType: entry.entityType,
    entitySyncId: entry.entitySyncId,
    operation: entry.operation,
  }));
}

describe('durable sync outbox', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  describe('mutation coverage', () => {
    it('queues one account upsert for every account mutation, including archive', () => {
      const account = accountService.createAccount({
        name: 'Cash',
        type: 'cash',
        openingBalanceMinor: 5000,
        currency: 'NPR',
      });
      expect(pending()).toEqual([
        { entityType: 'account', entitySyncId: account.syncId, operation: 'upsert' },
      ]);

      accountService.updateAccount(account.id, { name: 'Wallet' });
      accountService.archiveAccount(account.id);
      accountService.unarchiveAccount(account.id);

      // Archive is a normal domain change, never a cloud deletion.
      expect(pending()).toEqual([
        { entityType: 'account', entitySyncId: account.syncId, operation: 'upsert' },
      ]);
    });

    it('queues category mutations but never the seeded defaults', () => {
      expect(countPendingSyncMutations()).toBe(0);

      const category = categoryService.createCategory({ name: 'Pets', type: 'expense' });
      expect(pending()).toEqual([
        { entityType: 'category', entitySyncId: category.syncId, operation: 'upsert' },
      ]);

      categoryService.updateCategory(category.id, { name: 'Pet care' });
      expect(countPendingSyncMutations()).toBe(1);
    });

    it('queues one person upsert for every person mutation, including archive', () => {
      const person = personService.createPerson({ name: 'Ram' });
      personService.updatePerson(person.id, { note: 'Neighbour' });
      personService.archivePerson(person.id);

      expect(pending()).toEqual([
        { entityType: 'person', entitySyncId: person.syncId, operation: 'upsert' },
      ]);
    });

    it('queues a settings upsert when the syncable default currency changes', () => {
      const updated = settingsService.updateDefaultCurrency('usd');
      expect(updated.defaultCurrency).toBe('USD');
      expect(pending()).toEqual([
        { entityType: 'settings', entitySyncId: updated.syncId, operation: 'upsert' },
      ]);
    });

    it('queues one transaction operation for expense, income, and their edits', () => {
      const cash = makeAccount();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 1200,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: date,
      });
      const income = transactionService.createIncome({
        accountId: cash.id,
        categoryId: incomeCategory().id,
        amountMinor: 50000,
        title: 'Salary',
        paymentMode: 'bank_transfer',
        transactionDate: date,
      });
      transactionService.updateExpense(expense.id, { amountMinor: 1500 });

      expect(pending()).toEqual([
        { entityType: 'account', entitySyncId: cash.syncId, operation: 'upsert' },
        { entityType: 'transaction', entitySyncId: expense.syncId, operation: 'upsert' },
        { entityType: 'transaction', entitySyncId: income.syncId, operation: 'upsert' },
      ]);
    });

    it('queues a single transaction operation for a transfer, not per-account work', () => {
      const cash = makeAccount('Cash');
      const bank = makeAccount('Bank');
      const transfer = transactionService.createTransfer({
        sourceAccountId: cash.id,
        destinationAccountId: bank.id,
        amountMinor: 10000,
        transactionDate: date,
      });
      transactionService.updateTransfer(transfer.id, { amountMinor: 20000 });

      const transactionEntries = pending().filter((entry) => entry.entityType === 'transaction');
      expect(transactionEntries).toEqual([
        { entityType: 'transaction', entitySyncId: transfer.syncId, operation: 'upsert' },
      ]);
    });

    it('queues only the source transaction for lending, borrowing, and repayments', () => {
      const cash = makeAccount();
      const person = makePerson();
      const lend = transactionService.createLend({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 30000,
        transactionDate: date,
      });
      const repayment = transactionService.createRepaymentReceived({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 10000,
        transactionDate: date,
      });
      transactionService.updateLend(lend.id, { amountMinor: 40000 });

      const transactionEntries = pending().filter((entry) => entry.entityType === 'transaction');
      expect(transactionEntries).toEqual([
        { entityType: 'transaction', entitySyncId: lend.syncId, operation: 'upsert' },
        { entityType: 'transaction', entitySyncId: repayment.syncId, operation: 'upsert' },
      ]);
      // Person receivable/liability totals are derived and never queued.
      expect(pending().filter((entry) => entry.entityType === 'person')).toEqual([
        { entityType: 'person', entitySyncId: person.syncId, operation: 'upsert' },
      ]);
    });

    it('queues borrow and repayment-paid source records only', () => {
      const cash = makeAccount();
      const person = makePerson();
      const borrow = transactionService.createBorrow({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 25000,
        transactionDate: date,
      });
      const repaid = transactionService.createRepaymentPaid({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 5000,
        transactionDate: date,
      });

      expect(pending().filter((entry) => entry.entityType === 'transaction')).toEqual([
        { entityType: 'transaction', entitySyncId: borrow.syncId, operation: 'upsert' },
        { entityType: 'transaction', entitySyncId: repaid.syncId, operation: 'upsert' },
      ]);
    });

    it('never queues a derived financial figure', () => {
      const cash = makeAccount();
      const person = makePerson();
      transactionService.createLend({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 30000,
        transactionDate: date,
      });

      for (const entry of listPendingSyncMutations()) {
        expect(SYNC_ENTITY_TYPES).toContain(entry.entityType);
      }
      expect(new Set(pending().map((entry) => entry.entityType))).toEqual(
        new Set(['account', 'person', 'transaction']),
      );
    });
  });

  describe('coalescing', () => {
    it('keeps one pending upsert no matter how many times a record is edited', () => {
      const cash = makeAccount();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 1000,
        title: 'Tea',
        paymentMode: 'cash',
        transactionDate: date,
      });
      transactionService.updateExpense(expense.id, { amountMinor: 1100 });
      transactionService.updateExpense(expense.id, { amountMinor: 1200 });

      expect(pending().filter((entry) => entry.entityType === 'transaction')).toEqual([
        { entityType: 'transaction', entitySyncId: expense.syncId, operation: 'upsert' },
      ]);
    });

    it('cancels pending work when a never-synced record is created then deleted', () => {
      const cash = makeAccount();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 1000,
        title: 'Tea',
        paymentMode: 'cash',
        transactionDate: date,
      });
      transactionService.deleteTransaction(expense.id);

      // The cloud never knew this row, so it needs no tombstone.
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toBeNull();
      expect(() => transactionService.getTransaction(expense.id)).toThrow(/not found/i);
    });

    it('queues a delete when the database is bound to a cloud account', () => {
      const cash = makeAccount();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 1000,
        title: 'Tea',
        paymentMode: 'cash',
        transactionDate: date,
      });
      updateSyncState({ linkedUserId: '4f1c7c6e-2a2b-4a1a-9c9d-0b2f2a5e1f77' });

      transactionService.deleteTransaction(expense.id);

      expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
        operation: 'delete',
      });
    });

    it('never lets a later write downgrade a queued tombstone', () => {
      const cash = makeAccount();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: expenseCategory().id,
        amountMinor: 1000,
        title: 'Tea',
        paymentMode: 'cash',
        transactionDate: date,
      });
      updateSyncState({ linkedUserId: '4f1c7c6e-2a2b-4a1a-9c9d-0b2f2a5e1f77' });
      transactionService.deleteTransaction(expense.id);

      // A tombstoned row is invisible to the domain, so it cannot be edited back.
      expect(() => transactionService.updateExpense(expense.id, { amountMinor: 9999 })).toThrow(
        /not found/i,
      );
      expect(getPendingSyncMutation('transaction', expense.syncId!)).toMatchObject({
        operation: 'delete',
      });
    });
  });

  describe('queue behaviour', () => {
    it('lists pending work in deterministic queue order', () => {
      const first = makeAccount('A');
      const second = makeAccount('B');
      const third = makeAccount('C');

      expect(pending().map((entry) => entry.entitySyncId)).toEqual([
        first.syncId,
        second.syncId,
        third.syncId,
      ]);
      // Editing an old record does not move it to the back of the queue.
      accountService.updateAccount(first.id, { name: 'A2' });
      expect(pending().map((entry) => entry.entitySyncId)).toEqual([
        first.syncId,
        second.syncId,
        third.syncId,
      ]);
    });

    it('counts pending work for a future sync status', () => {
      expect(countPendingSyncMutations()).toBe(0);
      makeAccount('A');
      makeAccount('B');
      expect(countPendingSyncMutations()).toBe(2);
    });

    it('survives closing and reopening the database', () => {
      const account = makeAccount();
      reopenTestDatabase();
      migrateTestDatabase();

      expect(pending()).toEqual([
        { entityType: 'account', entitySyncId: account.syncId, operation: 'upsert' },
      ]);
    });

    it('records compact attempt metadata and clears acknowledged work', () => {
      const account = makeAccount();
      const entry = listPendingSyncMutations()[0]!;

      markSyncAttempt(entry.id, 'network_unavailable');
      const attempted = getPendingSyncMutation('account', account.syncId!);
      expect(attempted).toMatchObject({ attemptCount: 1, lastError: 'network_unavailable' });

      removeAcknowledgedSyncMutation(entry.id);
      expect(countPendingSyncMutations()).toBe(0);
    });

    it('resets failure metadata when a newer local change coalesces', () => {
      const account = makeAccount();
      markSyncAttempt(listPendingSyncMutations()[0]!.id, 'server_error');

      accountService.updateAccount(account.id, { name: 'Renamed' });

      expect(getPendingSyncMutation('account', account.syncId!)).toMatchObject({
        attemptCount: 0,
        lastError: null,
      });
    });
  });
});
