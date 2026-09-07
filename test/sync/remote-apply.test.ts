import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import {
  applyRemoteAccount,
  applyRemoteCategory,
  applyRemoteChanges,
  applyRemoteTombstone,
  applyRemoteTransaction,
} from '@/features/sync/remote-apply.repository';
import { countPendingSyncMutations, getPendingSyncMutation } from '@/features/sync/sync.repository';
import {
  getAccountBalance,
  getTotalBalance,
} from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

const remoteCreatedAt = new Date(2026, 0, 1);
const remoteUpdatedAt = new Date(2026, 5, 1);

describe('remote apply', () => {
  beforeEach(async () => {
    await setupDatabase();
  });
  afterAll(() => closeTestDatabase());

  it('applies a remote account change without queueing an upload', () => {
    const cash = makeAccount('Cash');
    const pendingBefore = countPendingSyncMutations();

    applyRemoteAccount({
      syncId: cash.syncId!,
      name: 'Cash (renamed elsewhere)',
      type: 'bank',
      openingBalanceMinor: 250000,
      currency: 'NPR',
      icon: null,
      isArchived: false,
      createdAt: cash.createdAt,
      updatedAt: remoteUpdatedAt,
    });

    const updated = accountService.getAccount(cash.id);
    expect(updated.name).toBe('Cash (renamed elsewhere)');
    expect(updated.openingBalanceMinor).toBe(250000);
    // Remote apply preserves the remote domain timestamp rather than stamping now.
    expect(updated.updatedAt.getTime()).toBe(remoteUpdatedAt.getTime());
    expect(countPendingSyncMutations()).toBe(pendingBefore);
  });

  it('inserts a remote transaction that derives correct balances and queues nothing', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const category = expenseCategory();
    const pendingBefore = countPendingSyncMutations();
    const syncId = randomUUID();

    applyRemoteTransaction({
      syncId,
      type: 'expense',
      amountMinor: 2500,
      currency: 'NPR',
      categorySyncId: category.syncId,
      sourceAccountSyncId: cash.syncId,
      destinationAccountSyncId: null,
      personSyncId: null,
      paymentMode: 'cash',
      transactionDate: new Date(2026, 0, 10),
      title: 'Remote lunch',
      note: null,
      createdAt: remoteCreatedAt,
      updatedAt: remoteUpdatedAt,
    });

    const listed = transactionService.listTransactions();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.syncId).toBe(syncId);
    expect(getAccountBalance(cash.id)).toBe(100000 - 2500);
    expect(countPendingSyncMutations()).toBe(pendingBefore);
  });

  it('hides a remotely deleted transaction from every derived figure', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 4000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 0, 10),
    });
    expect(getTotalBalance()).toBe(100000 - 4000);
    const pendingBefore = countPendingSyncMutations();

    applyRemoteTombstone({
      entityType: 'transaction',
      syncId: expense.syncId!,
      deletedAt: remoteUpdatedAt,
    });

    expect(transactionService.listTransactions()).toHaveLength(0);
    expect(() => transactionService.getTransaction(expense.id)).toThrow(/not found/i);
    expect(getAccountBalance(cash.id)).toBe(100000);
    expect(getTotalBalance()).toBe(100000);
    expect(countPendingSyncMutations()).toBe(pendingBefore);
  });

  it('queues an upload again when the user edits a remotely applied record', () => {
    const cash = makeAccount('Cash');
    applyRemoteAccount({
      syncId: cash.syncId!,
      name: 'Remote name',
      type: 'cash',
      openingBalanceMinor: 0,
      currency: 'NPR',
      icon: null,
      isArchived: false,
      createdAt: cash.createdAt,
      updatedAt: remoteUpdatedAt,
    });

    accountService.updateAccount(cash.id, { name: 'Local name' });

    // Remote origin must not permanently disable enqueueing for this record.
    expect(getPendingSyncMutation('account', cash.syncId!)).toMatchObject({ operation: 'upsert' });
    expect(accountService.getAccount(cash.id).name).toBe('Local name');
  });

  it('reconciles a downloaded built-in category by system key instead of duplicating it', () => {
    const seeded = expenseCategory();
    const remoteSyncId = randomUUID();
    const countBefore = categoryService.listCategories().length;
    const pendingBefore = countPendingSyncMutations();

    applyRemoteCategory({
      syncId: remoteSyncId,
      name: seeded.name,
      type: 'expense',
      icon: seeded.icon,
      systemKey: seeded.systemKey,
      isDefault: true,
      createdAt: seeded.createdAt,
      updatedAt: remoteUpdatedAt,
    });

    const categories = categoryService.listCategories();
    expect(categories).toHaveLength(countBefore);
    const reconciled = categories.find((item) => item.systemKey === seeded.systemKey)!;
    expect(reconciled.id).toBe(seeded.id);
    expect(reconciled.syncId).toBe(remoteSyncId);
    expect(countPendingSyncMutations()).toBe(pendingBefore);
  });

  it('applies a whole batch in dependency order inside one transaction', () => {
    const accountSyncId = randomUUID();
    const transactionSyncId = randomUUID();
    const category = expenseCategory();

    applyRemoteChanges({
      accounts: [
        {
          syncId: accountSyncId,
          name: 'Remote bank',
          type: 'bank',
          openingBalanceMinor: 500000,
          currency: 'NPR',
          icon: null,
          isArchived: false,
          createdAt: remoteCreatedAt,
          updatedAt: remoteCreatedAt,
        },
      ],
      transactions: [
        {
          syncId: transactionSyncId,
          type: 'expense',
          amountMinor: 1000,
          currency: 'NPR',
          categorySyncId: category.syncId,
          sourceAccountSyncId: accountSyncId,
          destinationAccountSyncId: null,
          personSyncId: null,
          paymentMode: 'cash',
          transactionDate: new Date(2026, 1, 2),
          title: 'Remote expense',
          note: null,
          createdAt: remoteCreatedAt,
          updatedAt: remoteCreatedAt,
        },
      ],
    });

    const account = accountService.listAccounts().find((item) => item.syncId === accountSyncId)!;
    expect(getAccountBalance(account.id)).toBe(500000 - 1000);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('rolls the whole batch back when one row references an unknown record', () => {
    const before = accountService.listAccounts().length;

    expect(() =>
      applyRemoteChanges({
        accounts: [
          {
            syncId: randomUUID(),
            name: 'Remote bank',
            type: 'bank',
            openingBalanceMinor: 500000,
            currency: 'NPR',
            icon: null,
            isArchived: false,
            createdAt: remoteCreatedAt,
            updatedAt: remoteCreatedAt,
          },
        ],
        transactions: [
          {
            syncId: randomUUID(),
            type: 'expense',
            amountMinor: 1000,
            currency: 'NPR',
            categorySyncId: null,
            sourceAccountSyncId: randomUUID(),
            destinationAccountSyncId: null,
            personSyncId: null,
            paymentMode: 'cash',
            transactionDate: new Date(2026, 1, 2),
            title: 'Orphan',
            note: null,
            createdAt: remoteCreatedAt,
            updatedAt: remoteCreatedAt,
          },
        ],
      }),
    ).toThrow(/unknown account/);

    expect(accountService.listAccounts()).toHaveLength(before);
    expect(transactionService.listTransactions()).toHaveLength(0);
  });
});
