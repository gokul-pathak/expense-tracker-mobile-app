import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import type { SyncEntityType } from '@/db/schema';
import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as settingsService from '@/features/settings/settings.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import { updateSyncState } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  expenseCategory,
  incomeCategory,
  makeAccount,
  makePerson,
  setupDatabase,
} from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const financialDate = new Date(2025, 10, 3, 12);

let cloud: FakeCloud;

function push() {
  return pushPendingChanges({
    dependencies: {
      getAuthenticatedUserId: async () => USER,
      createRemote: () => cloud.repository,
    },
  });
}

function remote(entityType: SyncEntityType, syncId: string) {
  const row = cloud.rowBySyncId(entityType, syncId);
  if (row === undefined) throw new Error(`No remote ${entityType} for ${syncId}`);
  return row as unknown as Record<string, unknown>;
}

describe('local to cloud mapping', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: USER });
  });
  afterAll(() => closeTestDatabase());

  it('maps an account onto the cloud contract without derived figures', async () => {
    const cash = accountService.createAccount({
      name: 'Cash',
      type: 'wallet',
      openingBalanceMinor: 250000,
      currency: 'npr',
      icon: 'wallet',
    });

    await push();

    expect(remote('account', cash.syncId!)).toEqual({
      sync_id: cash.syncId,
      // Ownership comes from the trusted session, never from local data.
      user_id: USER,
      name: 'Cash',
      type: 'wallet',
      opening_balance_minor: 250000,
      currency: 'NPR',
      icon: 'wallet',
      is_archived: false,
      created_at: cash.createdAt.getTime(),
      updated_at: cash.updatedAt.getTime(),
      deleted_at: null,
    });
  });

  it('maps a category and preserves built-in identity', async () => {
    const seeded = expenseCategory();
    const custom = categoryService.createCategory({ name: 'Pets', type: 'expense' });
    // Touch the seeded default so it becomes queued work.
    transactionService.createExpense({
      accountId: makeAccount().id,
      categoryId: seeded.id,
      amountMinor: 100,
      title: 'Food',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    await push();

    expect(remote('category', custom.syncId!)).toMatchObject({
      user_id: USER,
      name: 'Pets',
      type: 'expense',
      system_key: null,
      is_default: false,
      deleted_at: null,
    });
  });

  it('maps a person without any receivable or liability figure', async () => {
    const person = personService.createPerson({ name: 'Ram', note: 'Neighbour' });

    await push();

    const row = remote('person', person.syncId!);
    expect(row).toEqual({
      sync_id: person.syncId,
      user_id: USER,
      name: 'Ram',
      note: 'Neighbour',
      is_archived: false,
      created_at: person.createdAt.getTime(),
      updated_at: person.updatedAt.getTime(),
      deleted_at: null,
    });
    expect(Object.keys(row)).not.toContain('receivable_minor');
    expect(Object.keys(row)).not.toContain('liability_minor');
  });

  it('maps settings as one user-global record', async () => {
    const updated = settingsService.updateDefaultCurrency('usd');

    await push();

    expect(remote('settings', updated.syncId!)).toEqual({
      sync_id: updated.syncId,
      user_id: USER,
      default_currency: 'USD',
      created_at: updated.createdAt.getTime(),
      updated_at: updated.updatedAt.getTime(),
      deleted_at: null,
    });
  });

  it('replaces every local foreign key with a global sync identity', async () => {
    const cash = makeAccount('Cash');
    const category = expenseCategory();
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: category.id,
      amountMinor: 1299,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    await push();

    const row = remote('transaction', expense.syncId!);
    expect(row.source_account_sync_id).toBe(cash.syncId);
    expect(row.category_sync_id).toBe(category.syncId);
    // Local integers must never become cross-device identity.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(`"source_account_sync_id":${cash.id}`);
    expect(row.source_account_sync_id).not.toBe(cash.id);
    expect(row.category_sync_id).not.toBe(category.id);
  });

  it('keeps money in exact integer minor units', async () => {
    const cash = makeAccount('Cash');
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1299,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    await push();

    const amount = remote('transaction', expense.syncId!).amount_minor;
    expect(amount).toBe(1299);
    expect(Number.isInteger(amount)).toBe(true);
  });

  it('uploads a large safe integer without precision loss', async () => {
    const cash = makeAccount('Cash', 'NPR', 0);
    const large = Number.MAX_SAFE_INTEGER - 1;
    const income = transactionService.createIncome({
      accountId: cash.id,
      categoryId: incomeCategory().id,
      amountMinor: large,
      title: 'Windfall',
      paymentMode: 'bank_transfer',
      transactionDate: financialDate,
    });

    await push();

    const amount = remote('transaction', income.syncId!).amount_minor;
    expect(amount).toBe(large);
    expect(Number.isSafeInteger(amount)).toBe(true);
  });

  it('keeps a backdated financial date independent of the update timestamp', async () => {
    const cash = makeAccount('Cash');
    const expense = transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 500,
      title: 'Old receipt',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    await push();

    const row = remote('transaction', expense.syncId!);
    expect(row.transaction_date).toBe(financialDate.getTime());
    expect(row.created_at).toBe(expense.createdAt.getTime());
    // Upload time never overwrites domain history.
    expect(row.updated_at).toBe(expense.updatedAt.getTime());
    expect(Number(row.transaction_date)).toBeLessThan(Number(row.created_at));
  });

  describe('transaction semantics', () => {
    it('keeps an expense an expense', async () => {
      const cash = makeAccount('Cash');
      const category = expenseCategory();
      const expense = transactionService.createExpense({
        accountId: cash.id,
        categoryId: category.id,
        amountMinor: 4200,
        title: 'Lunch',
        paymentMode: 'cash',
        transactionDate: financialDate,
      });

      await push();

      expect(remote('transaction', expense.syncId!)).toMatchObject({
        type: 'expense',
        amount_minor: 4200,
        source_account_sync_id: cash.syncId,
        destination_account_sync_id: null,
        category_sync_id: category.syncId,
        person_sync_id: null,
      });
    });

    it('keeps income on its destination account', async () => {
      const bank = makeAccount('Bank');
      const category = incomeCategory();
      const income = transactionService.createIncome({
        accountId: bank.id,
        categoryId: category.id,
        amountMinor: 80000,
        title: 'Salary',
        paymentMode: 'bank_transfer',
        transactionDate: financialDate,
      });

      await push();

      expect(remote('transaction', income.syncId!)).toMatchObject({
        type: 'income',
        destination_account_sync_id: bank.syncId,
        source_account_sync_id: null,
        category_sync_id: category.syncId,
        person_sync_id: null,
      });
    });

    it('uploads a transfer as one transfer, never as an expense plus income', async () => {
      const cash = makeAccount('Cash');
      const bank = makeAccount('Bank');
      const transfer = transactionService.createTransfer({
        sourceAccountId: bank.id,
        destinationAccountId: cash.id,
        amountMinor: 25000,
        transactionDate: financialDate,
      });

      await push();

      const rows = cloud.rows('transaction') as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sync_id: transfer.syncId,
        type: 'transfer',
        source_account_sync_id: bank.syncId,
        destination_account_sync_id: cash.syncId,
        category_sync_id: null,
        person_sync_id: null,
      });
      expect(rows.some((row) => row.type === 'expense' || row.type === 'income')).toBe(false);
    });

    it('keeps lending, borrowing and repayments as their own types', async () => {
      const cash = makeAccount('Cash', 'NPR', 1000000);
      const person = makePerson('Ram');
      const lend = transactionService.createLend({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 30000,
        transactionDate: financialDate,
      });
      const borrow = transactionService.createBorrow({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 20000,
        transactionDate: financialDate,
      });
      const received = transactionService.createRepaymentReceived({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 10000,
        transactionDate: financialDate,
      });
      const paid = transactionService.createRepaymentPaid({
        personId: person.id,
        accountId: cash.id,
        amountMinor: 5000,
        transactionDate: financialDate,
      });

      await push();

      expect(remote('transaction', lend.syncId!)).toMatchObject({
        type: 'lend',
        person_sync_id: person.syncId,
        source_account_sync_id: cash.syncId,
        destination_account_sync_id: null,
        category_sync_id: null,
      });
      expect(remote('transaction', borrow.syncId!)).toMatchObject({
        type: 'borrow',
        person_sync_id: person.syncId,
        destination_account_sync_id: cash.syncId,
        source_account_sync_id: null,
        category_sync_id: null,
      });
      expect(remote('transaction', received.syncId!)).toMatchObject({
        type: 'repayment_received',
        destination_account_sync_id: cash.syncId,
        person_sync_id: person.syncId,
      });
      expect(remote('transaction', paid.syncId!)).toMatchObject({
        type: 'repayment_paid',
        source_account_sync_id: cash.syncId,
        person_sync_id: person.syncId,
      });
    });
  });

  it('uploads no derived balance, savings or summary anywhere', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const person = makePerson('Ram');
    transactionService.createLend({
      personId: person.id,
      accountId: cash.id,
      amountMinor: 30000,
      transactionDate: financialDate,
    });
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 1000,
      title: 'Tea',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    await push();

    const uploaded = JSON.stringify(cloud.calls);
    // Opening balance is source data; a computed balance would not be.
    expect(uploaded).toContain('opening_balance_minor');
    for (const forbidden of [
      'current_balance',
      'currentBalance',
      'savings',
      'receivable',
      'liability',
      'total_income',
      'category_percentage',
      'dashboard',
      'report',
    ]) {
      expect(uploaded).not.toContain(forbidden);
    }
  });
});
