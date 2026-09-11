import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { isSyncId } from '@/db/schema';
import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getTotalBalance } from '@/features/dashboard/dashboard.service';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import {
  RecurringConflictError,
  RecurringValidationError,
} from '@/features/recurring/recurring.errors';
import * as recurring from '@/features/recurring/recurring.service';
import { getReportSummary } from '@/features/reports/reports.service';
import { NotFoundError, ValidationError } from '@/features/shared/errors';
import { describeErrorChain } from '@/features/ui/error-message';
import { applyRemoteTombstone } from '@/features/sync/remote-apply.repository';
import { countPendingSyncMutations, getPendingSyncMutation } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import * as transactionService from '@/features/transactions/transaction.service';
import { getMonthRange } from '@/utils/date-range';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

import {
  buildRecurringFixture,
  createGroceryRun,
  createRent,
  createSalary,
  rupees,
  type RecurringFixture,
} from './fixture';

/**
 * The recurring engine, against real SQLite.
 *
 * Two properties carry the weight here. A template is a plan and moves no money
 * at all. A generated occurrence is an ordinary transaction, dated on its
 * scheduled day, recorded exactly once — however many times anyone asks for it,
 * and whatever fails halfway through writing it.
 */

const AS_OF = '2026-09-20';
let fixture: RecurringFixture;

/** Every figure a recurring plan must never move on its own. */
function accounting() {
  return {
    total: getTotalBalance(),
    bank: getAccountBalance(fixture.bank.id),
    cash: getAccountBalance(fixture.cash.id),
    september: getReportSummary(getMonthRange(2026, 8)),
    august: getReportSummary(getMonthRange(2026, 7)),
    transactions: transactionService.listTransactions().length,
  };
}

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

function dueDates(options: { asOfDate?: string; templateId?: number; limit?: number } = {}) {
  return recurring
    .listDueOccurrences({ asOfDate: AS_OF, ...options })
    .occurrences.map((item) => item.occurrenceDate);
}

/** The whole error chain: the driver wraps SQLite's own message in a `cause`. */
function failureOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return describeErrorChain(error);
  }
  return 'did not throw';
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RecurringConflictError || error instanceof RecurringValidationError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

describe('a template is a plan, not a transaction', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('creates a template with its own random identity and moves no money', () => {
    const before = accounting();
    const template = createGroceryRun(fixture);

    expect(isSyncId(template.syncId)).toBe(true);
    expect(template.syncId![14]).toBe('4');
    expect(template.currency).toBe('NPR');
    expect(getPendingSyncMutation('recurring_template', template.syncId!)?.operation).toBe(
      'upsert',
    );
    expect(accounting()).toEqual(before);
  });

  it('adds nothing to a budget until an occurrence is generated', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    createGroceryRun(fixture, { startDate: '2026-09-01' });

    const food = budgetService.getMonthlyBudgetSummary('2026-09').categoryBudgets[0]!;
    expect(food.spentMinor).toBe(0);
  });

  it('refuses every type that is not an expense or income', () => {
    for (const type of ['transfer', 'lend', 'borrow', 'repayment_received', 'repayment_paid']) {
      expect(() => createGroceryRun(fixture, { type: type as never })).toThrow(ValidationError);
    }
  });

  it('refuses a category of the other type', () => {
    expect(() => createGroceryRun(fixture, { categoryId: fixture.salary.id })).toThrow(
      ValidationError,
    );
    expect(() => createSalary(fixture, { categoryId: fixture.food.id })).toThrow(ValidationError);
  });

  it('refuses an archived account', () => {
    accountService.archiveAccount(fixture.cash.id);
    expect(() => createGroceryRun(fixture, { accountId: fixture.cash.id })).toThrow(
      ValidationError,
    );
  });

  it('refuses an end date before the start, and an interval out of range', () => {
    expect(() => createGroceryRun(fixture, { endDate: '2026-06-14' })).toThrow(ValidationError);
    expect(() => createGroceryRun(fixture, { interval: 0 })).toThrow(ValidationError);
    expect(() => createGroceryRun(fixture, { interval: 1000 })).toThrow(ValidationError);
    expect(() => createGroceryRun(fixture, { startDate: '2026-02-30' })).toThrow(ValidationError);
    // The end date itself is fine: it is inclusive.
    expect(createGroceryRun(fixture, { endDate: '2026-06-15' }).endDate).toBe('2026-06-15');
  });

  it('takes its currency from the account, as a transaction does', () => {
    const dollars = createGroceryRun(fixture, { accountId: fixture.dollars.id });
    expect(dollars.currency).toBe('USD');
  });
});

describe('what is due', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('derives every unhandled date up to the as-of date, oldest first', () => {
    // The milestone's fixture: monthly from June 15, nothing handled, asked on Sep 20.
    const template = createGroceryRun(fixture);
    expect(dueDates()).toEqual(['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15']);
    // Nothing is stored until someone decides.
    expect(count('recurring_occurrences')).toBe(0);
    expect(recurring.getNextDueDate(template.id)).toBe('2026-06-15');
  });

  it('drops a date once it is generated, and another once it is skipped', () => {
    const template = createGroceryRun(fixture);

    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(dueDates()).toEqual(['2026-07-15', '2026-08-15', '2026-09-15']);

    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });
    expect(dueDates()).toEqual(['2026-08-15', '2026-09-15']);
    // July produced nothing.
    expect(count('transactions', "title = 'Food box'")).toBe(1);
  });

  it('never lists a date that has not arrived', () => {
    createGroceryRun(fixture);
    expect(dueDates({ asOfDate: '2026-09-14' })).toEqual([
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
    ]);
    expect(dueDates({ asOfDate: '2026-06-14' })).toEqual([]);
  });

  it('orders several templates by date and then by identity, the same way every time', () => {
    createGroceryRun(fixture);
    createSalary(fixture);
    const first = recurring.listDueOccurrences({ asOfDate: '2026-07-20' });
    const second = recurring.listDueOccurrences({ asOfDate: '2026-07-20' });

    expect(first).toEqual(second);
    expect(first.occurrences.map((item) => item.occurrenceDate)).toEqual([
      '2026-06-01',
      '2026-06-15',
      '2026-07-01',
      '2026-07-15',
    ]);
  });

  it('bounds the answer and never drops the oldest dates to fit', () => {
    recurring.createRecurringTemplate({
      type: 'expense',
      amountMinor: rupees(100),
      categoryId: fixture.food.id,
      accountId: fixture.cash.id,
      startDate: '2026-01-01',
      frequency: 'daily',
    });

    const due = recurring.listDueOccurrences({ asOfDate: AS_OF });
    expect(due.occurrences).toHaveLength(100);
    expect(due.hasMore).toBe(true);
    expect(due.occurrences[0]?.occurrenceDate).toBe('2026-01-01');
    expect(due.occurrences.at(-1)?.occurrenceDate).toBe('2026-04-10');

    expect(() => recurring.listDueOccurrences({ asOfDate: AS_OF, limit: 0 })).toThrow(
      ValidationError,
    );
    expect(() => recurring.listDueOccurrences({ asOfDate: AS_OF, limit: 101 })).toThrow(
      ValidationError,
    );
  });

  it('stops at an inclusive end date', () => {
    createGroceryRun(fixture, { startDate: '2026-06-30', endDate: '2026-09-30' });
    expect(dueDates({ asOfDate: '2026-12-31' })).toEqual([
      '2026-06-30',
      '2026-07-30',
      '2026-08-30',
      '2026-09-30',
    ]);
  });

  it('still lists a date whose template cannot generate, and says why', () => {
    createGroceryRun(fixture);
    accountService.archiveAccount(fixture.bank.id);

    const due = recurring.listDueOccurrences({ asOfDate: AS_OF });
    expect(due.occurrences).toHaveLength(4);
    expect(due.occurrences.every((item) => item.blockedReason === 'account_archived')).toBe(true);
  });
});

describe('generating an occurrence', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('records an ordinary expense on the scheduled date, with derived identities', () => {
    const template = createRent(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-08-31', {
      asOfDate: '2026-09-03',
    });
    const transaction = transactionService.getTransaction(generated.transactionId!);

    expect(generated.outcome).toBe('generated');
    expect(transaction).toMatchObject({
      type: 'expense',
      amountMinor: rupees(20_000),
      currency: 'NPR',
      categoryId: fixture.bills.id,
      sourceAccountId: fixture.bank.id,
      destinationAccountId: null,
      personId: null,
      paymentMode: 'bank_transfer',
      title: 'Rent',
      recurringOccurrenceId: generated.occurrence.id,
    });
    // Dated on the day it was due, not the day it was recorded.
    expect(localDateOf(transaction.transactionDate)).toBe('2026-08-31');
    expect(localDateOf(transaction.createdAt)).not.toBe('2026-08-31');

    const occurrenceSyncId = deriveOccurrenceSyncId(template.syncId!, '2026-08-31');
    expect(generated.occurrence.syncId).toBe(occurrenceSyncId);
    expect(transaction.syncId).toBe(deriveGeneratedTransactionSyncId(occurrenceSyncId));
    expect(getPendingSyncMutation('recurring_occurrence', occurrenceSyncId)?.operation).toBe(
      'upsert',
    );
    expect(getPendingSyncMutation('transaction', transaction.syncId!)?.operation).toBe('upsert');
  });

  it('files an overdue occurrence in the month it was due', () => {
    const template = createGroceryRun(fixture);
    // Generated on September 20 for August 15.
    const generated = recurring.generateOccurrence(template.id, '2026-08-15', { asOfDate: AS_OF });
    const transaction = transactionService.getTransaction(generated.transactionId!);

    expect(localDateOf(transaction.transactionDate)).toBe('2026-08-15');
    expect(getReportSummary(getMonthRange(2026, 7)).expenseMinor).toBe(rupees(5_000));
    expect(getReportSummary(getMonthRange(2026, 8)).expenseMinor).toBe(0);
  });

  it('counts a generated expense towards its budget through the ordinary queries', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-09',
      amountMinor: rupees(15_000),
    });
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-09-15', { asOfDate: AS_OF });

    const food = budgetService.getMonthlyBudgetSummary('2026-09').categoryBudgets[0]!;
    expect(food.spentMinor).toBe(rupees(5_000));
  });

  it('records a generated income as income, and nothing else', () => {
    budgetService.createBudget({ periodMonth: '2026-09', amountMinor: rupees(40_000) });
    const before = getReportSummary(getMonthRange(2026, 8));
    const bankBefore = getAccountBalance(fixture.bank.id);
    const template = createSalary(fixture);

    const generated = recurring.generateOccurrence(template.id, '2026-09-01', { asOfDate: AS_OF });
    const transaction = transactionService.getTransaction(generated.transactionId!);
    const after = getReportSummary(getMonthRange(2026, 8));

    expect(transaction).toMatchObject({
      type: 'income',
      destinationAccountId: fixture.bank.id,
      sourceAccountId: null,
      categoryId: fixture.salary.id,
    });
    expect(after.incomeMinor - before.incomeMinor).toBe(rupees(65_000));
    expect(after.expenseMinor).toBe(before.expenseMinor);
    expect(getAccountBalance(fixture.bank.id) - bankBefore).toBe(rupees(65_000));
    expect(budgetService.getMonthlyBudgetSummary('2026-09').overallBudget?.spentMinor).toBe(0);
  });

  it('is idempotent: asking twice records one occurrence and one transaction', () => {
    const template = createGroceryRun(fixture);
    const first = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    const second = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect(second.outcome).toBe('already_generated');
    expect(second.occurrence.id).toBe(first.occurrence.id);
    expect(second.transactionId).toBe(first.transactionId);
    expect(count('recurring_occurrences')).toBe(1);
    expect(count('transactions', `recurring_occurrence_id = ${first.occurrence.id}`)).toBe(1);
    expect(getAccountBalance(fixture.bank.id)).toBe(rupees(1_000_000 - 5_000));
  });

  it('refuses a date the schedule never lands on', () => {
    const template = createGroceryRun(fixture);
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-09-14', { asOfDate: AS_OF })),
    ).toBe('not_scheduled');
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-09-15x', { asOfDate: AS_OF })),
    ).toBe('invalid_date');
  });

  it('refuses a date that has not arrived', () => {
    const template = createGroceryRun(fixture);
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-10-15', { asOfDate: AS_OF })),
    ).toBe('future_occurrence');
    expect(count('recurring_occurrences')).toBe(0);
  });

  it('refuses a date after the end date', () => {
    const template = createGroceryRun(fixture, { startDate: '2026-06-30', endDate: '2026-09-30' });
    expect(
      codeOf(() =>
        recurring.generateOccurrence(template.id, '2026-10-30', { asOfDate: '2026-11-01' }),
      ),
    ).toBe('not_scheduled');
  });

  it('does not turn a skipped date into a generated one', () => {
    const template = createGroceryRun(fixture);
    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF })),
    ).toBe('occurrence_already_skipped');
    expect(count('transactions', "title = 'Food box'")).toBe(0);
  });

  it('refuses a template that does not exist or has been deleted', () => {
    const template = createGroceryRun(fixture);
    recurring.deleteRecurringTemplate(template.id);
    expect(() =>
      recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF }),
    ).toThrow(NotFoundError);
    expect(() => recurring.generateOccurrence(9_999, '2026-06-15', { asOfDate: AS_OF })).toThrow(
      NotFoundError,
    );
  });
});

describe('skipping an occurrence', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('has no financial effect and takes the date off the list for good', () => {
    budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: '2026-07',
      amountMinor: rupees(15_000),
    });
    const template = createGroceryRun(fixture);
    const before = accounting();

    const skipped = recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });

    expect(skipped.outcome).toBe('skipped');
    expect(skipped.occurrence.status).toBe('skipped');
    expect(accounting()).toEqual(before);
    expect(budgetService.getMonthlyBudgetSummary('2026-07').categoryBudgets[0]?.spentMinor).toBe(0);
    expect(dueDates()).not.toContain('2026-07-15');
    expect(
      getPendingSyncMutation('recurring_occurrence', skipped.occurrence.syncId!),
    ).not.toBeNull();
  });

  it('returns the existing decision when asked twice', () => {
    const template = createGroceryRun(fixture);
    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });
    const again = recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });

    expect(again.outcome).toBe('already_skipped');
    expect(count('recurring_occurrences')).toBe(1);
  });

  it('does not skip a date that already produced a transaction', () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect(
      codeOf(() => recurring.skipOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF })),
    ).toBe('occurrence_already_generated');
    expect(transactionService.getTransaction(generated.transactionId!)).toBeDefined();
  });
});

describe('pausing and resuming', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('hides a paused template from generation and keeps its history', () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    const paused = recurring.pauseRecurringTemplate(template.id);
    expect(paused.isPaused).toBe(true);
    expect(dueDates()).toEqual([]);
    expect(transactionService.getTransaction(generated.transactionId!)).toBeDefined();
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF })),
    ).toBe('template_paused');
    expect(
      codeOf(() => recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF })),
    ).toBe('template_paused');
  });

  it('brings back every date that passed while paused, rather than forgiving them', () => {
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: '2026-06-20' });
    recurring.pauseRecurringTemplate(template.id);

    // July, August and September pass while it is paused.
    expect(dueDates({ asOfDate: AS_OF })).toEqual([]);

    recurring.resumeRecurringTemplate(template.id);
    expect(dueDates({ asOfDate: AS_OF })).toEqual(['2026-07-15', '2026-08-15', '2026-09-15']);
  });

  it('treats pausing an already paused template as nothing to do', () => {
    const template = createGroceryRun(fixture);
    const pending = countPendingSyncMutations();
    recurring.resumeRecurringTemplate(template.id);
    expect(countPendingSyncMutations()).toBe(pending);
  });
});

describe('a template that can no longer generate', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('refuses an archived account and writes nothing at all', () => {
    const template = createGroceryRun(fixture);
    accountService.archiveAccount(fixture.bank.id);
    const pending = countPendingSyncMutations();
    const transactions = count('transactions');

    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF })),
    ).toBe('account_archived');
    expect(count('recurring_occurrences')).toBe(0);
    expect(count('transactions')).toBe(transactions);
    expect(countPendingSyncMutations()).toBe(pending);
    // Still due: blocked is not skipped.
    expect(dueDates()).toContain('2026-06-15');
  });

  it('refuses a category deleted elsewhere', () => {
    const template = createGroceryRun(fixture);
    applyRemoteTombstone({
      entityType: 'category',
      syncId: fixture.food.syncId!,
      deletedAt: new Date(),
    });
    expect(
      codeOf(() => recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF })),
    ).toBe('category_deleted');
    expect(count('recurring_occurrences')).toBe(0);
  });
});

describe('atomic generation', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  /** A failure injected by SQLite itself, at exactly one step of the write. */
  function failOn(name: string, statement: string) {
    rawClient().exec(
      `CREATE TRIGGER ${name} ${statement} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
    );
    return () => rawClient().exec(`DROP TRIGGER ${name}`);
  }

  it('rolls the occurrence back when the transaction cannot be written', () => {
    const template = createGroceryRun(fixture);
    const pending = countPendingSyncMutations();
    const restore = failOn('fail_generated_insert', 'BEFORE INSERT ON transactions');

    expect(
      failureOf(() => recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF })),
    ).toMatch(/injected failure/);
    expect(count('recurring_occurrences')).toBe(0);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(0);
    expect(countPendingSyncMutations()).toBe(pending);

    // Nothing was half-recorded, so the date is simply still due and works now.
    restore();
    expect(dueDates()).toContain('2026-06-15');
    expect(
      recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF }).outcome,
    ).toBe('generated');
  });

  it('rolls everything back when the transaction’s queue entry cannot be written', () => {
    const template = createGroceryRun(fixture);
    const pending = countPendingSyncMutations();
    const restore = failOn(
      'fail_generated_outbox',
      "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type = 'transaction'",
    );

    expect(
      failureOf(() => recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF })),
    ).toMatch(/injected failure/);
    expect(count('recurring_occurrences')).toBe(0);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(0);
    expect(count('sync_outbox', "entity_type = 'recurring_occurrence'")).toBe(0);
    expect(countPendingSyncMutations()).toBe(pending);
    restore();
  });

  it('keeps a batch going past one template that fails and one that is blocked', () => {
    const good = createGroceryRun(fixture, { startDate: '2026-09-15' });
    const failing = createGroceryRun(fixture, {
      startDate: '2026-09-15',
      amountMinor: 111,
      title: 'Fails',
    });
    const blocked = createGroceryRun(fixture, {
      startDate: '2026-09-15',
      accountId: fixture.cash.id,
      title: 'Blocked',
    });
    accountService.archiveAccount(fixture.cash.id);
    const restore = failOn(
      'fail_one_amount',
      'BEFORE INSERT ON transactions WHEN NEW.amount_minor = 111',
    );

    const result = recurring.generateDueOccurrences({ asOfDate: AS_OF });
    restore();

    expect(result.generated.map((item) => item.templateId)).toEqual([good.id]);
    expect(result.failed.map((item) => item.templateId)).toEqual([failing.id]);
    expect(result.blocked).toEqual([
      { templateId: blocked.id, occurrenceDate: '2026-09-15', reason: 'account_archived' },
    ]);
    // Each failure left its own date due and touched nothing else.
    expect(dueDates()).toEqual(['2026-09-15', '2026-09-15']);
  });

  it('is safe to run a batch twice', () => {
    createGroceryRun(fixture);
    const first = recurring.generateDueOccurrences({ asOfDate: AS_OF });
    const second = recurring.generateDueOccurrences({ asOfDate: AS_OF });

    expect(first.generated).toHaveLength(4);
    expect(second.generated).toHaveLength(0);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(4);
  });
});

describe('what already happened stays as it happened', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('does not bring a date back after its transaction is deleted', () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    const bankAfter = getAccountBalance(fixture.bank.id);

    transactionService.deleteTransaction(generated.transactionId!);

    expect(getAccountBalance(fixture.bank.id)).toBe(bankAfter + rupees(5_000));
    expect(dueDates()).not.toContain('2026-06-15');
    const again = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(again.outcome).toBe('already_generated');
    expect(again.transactionId).toBeNull();
    expect(
      count('transactions', 'deleted_at IS NULL AND recurring_occurrence_id IS NOT NULL'),
    ).toBe(0);
  });

  it('changes future amounts only when the template is edited', () => {
    const template = createGroceryRun(fixture, { amountMinor: rupees(10_000) });
    const september = recurring.generateOccurrence(template.id, '2026-09-15', {
      asOfDate: '2026-10-20',
    });
    recurring.updateRecurringTemplate(template.id, { amountMinor: rupees(12_000) });
    const october = recurring.generateOccurrence(template.id, '2026-10-15', {
      asOfDate: '2026-10-20',
    });

    expect(transactionService.getTransaction(september.transactionId!).amountMinor).toBe(
      rupees(10_000),
    );
    expect(transactionService.getTransaction(october.transactionId!).amountMinor).toBe(
      rupees(12_000),
    );
  });

  it('changes future categories only when the template is edited', () => {
    const template = createGroceryRun(fixture);
    const september = recurring.generateOccurrence(template.id, '2026-09-15', {
      asOfDate: '2026-10-20',
    });
    recurring.updateRecurringTemplate(template.id, { categoryId: fixture.groceries.id });
    const october = recurring.generateOccurrence(template.id, '2026-10-15', {
      asOfDate: '2026-10-20',
    });

    expect(transactionService.getTransaction(september.transactionId!).categoryId).toBe(
      fixture.food.id,
    );
    expect(transactionService.getTransaction(october.transactionId!).categoryId).toBe(
      fixture.groceries.id,
    );
  });

  it('stops the schedule when the template is deleted and keeps every transaction', () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    recurring.deleteRecurringTemplate(template.id);

    expect(transactionService.getTransaction(generated.transactionId!).amountMinor).toBe(
      rupees(5_000),
    );
    expect(count('recurring_occurrences', 'deleted_at IS NULL')).toBe(1);
    expect(dueDates()).toEqual([]);
    expect(() => recurring.getRecurringTemplate(template.id)).toThrow(NotFoundError);
    // Created and deleted before the cloud ever saw it, so its queued upload is
    // withdrawn rather than followed by a tombstone. A linked device uploads the
    // tombstone; `test/sync/recurring-sync.test.ts` covers that.
    expect(getPendingSyncMutation('recurring_template', template.syncId!)).toBeNull();
  });

  it('lets a generated transaction be edited like any other, keeping its provenance', () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    const edited = transactionService.updateExpense(generated.transactionId!, {
      amountMinor: rupees(4_200),
    });
    expect(edited.amountMinor).toBe(rupees(4_200));
    expect(edited.recurringOccurrenceId).toBe(generated.occurrence.id);
  });

  it('locks the schedule once a date has been handled, but not the rest', () => {
    const template = createGroceryRun(fixture);
    // Before anything is handled the schedule is still a draft.
    expect(
      recurring.updateRecurringTemplate(template.id, { startDate: '2026-06-16' }).startDate,
    ).toBe('2026-06-16');

    recurring.generateOccurrence(template.id, '2026-06-16', { asOfDate: AS_OF });
    recurring.skipOccurrence(template.id, '2026-07-16', { asOfDate: AS_OF });
    expect(
      codeOf(() => recurring.updateRecurringTemplate(template.id, { frequency: 'weekly' })),
    ).toBe('schedule_locked');
    expect(codeOf(() => recurring.updateRecurringTemplate(template.id, { interval: 2 }))).toBe(
      'schedule_locked',
    );
    expect(
      codeOf(() => recurring.updateRecurringTemplate(template.id, { startDate: '2026-06-01' })),
    ).toBe('schedule_locked');
    // The amount, and an end date after what was handled, are still editable.
    expect(recurring.updateRecurringTemplate(template.id, { amountMinor: 1 }).amountMinor).toBe(1);
    expect(recurring.updateRecurringTemplate(template.id, { endDate: '2026-12-31' }).endDate).toBe(
      '2026-12-31',
    );
    // After the start but before July's handled date.
    expect(
      codeOf(() => recurring.updateRecurringTemplate(template.id, { endDate: '2026-06-30' })),
    ).toBe('end_before_handled');
  });

  it('never changes a template’s type', () => {
    const template = createGroceryRun(fixture);
    expect(() =>
      recurring.updateRecurringTemplate(template.id, { type: 'income' } as never),
    ).toThrow(ValidationError);
  });
});

describe('the template list', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('puts active templates first, then by the date they next need attention', () => {
    const paused = createGroceryRun(fixture, { title: 'Paused', startDate: '2026-01-15' });
    recurring.pauseRecurringTemplate(paused.id);
    const july = createGroceryRun(fixture, { title: 'July', startDate: '2026-07-15' });
    const june = createGroceryRun(fixture, { title: 'June', startDate: '2026-06-15' });

    const list = recurring.listRecurringTemplates();
    expect(list.map((item) => item.id)).toEqual([june.id, july.id, paused.id]);
    expect(list[0]).toMatchObject({ nextDueDate: '2026-06-15', handledCount: 0 });
  });

  it('derives the next due date from what has been handled', () => {
    const template = createGroceryRun(fixture, { endDate: '2026-07-15' });
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    expect(recurring.getNextDueDate(template.id)).toBe('2026-07-15');

    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });
    // Every date of an ended schedule is handled: nothing is next.
    expect(recurring.getNextDueDate(template.id)).toBeNull();
  });
});

describe('everything else stays as it was', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('gives a hand-entered transaction a random identity and no link', () => {
    const expense = transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId: fixture.food.id,
      amountMinor: rupees(500),
      title: 'Lunch',
      transactionDate: new Date(2026, 8, 10),
    });
    expect(expense.syncId![14]).toBe('4');
    expect(expense.recurringOccurrenceId).toBeNull();
  });

  it('works entirely offline, queueing each thing it writes', () => {
    const before = countPendingSyncMutations();
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });

    // The template, the generated occurrence and its transaction, the skip.
    expect(countPendingSyncMutations() - before).toBe(4);
  });
});
