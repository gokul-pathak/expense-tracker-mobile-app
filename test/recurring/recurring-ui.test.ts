import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import {
  describeGenerateDueResult,
  dueLabel,
  getHistoryEntryLabel,
  getNextDueLabel,
  getTemplateStatusLabel,
  templateLabel,
} from '@/features/recurring/recurring-presentation';
import { RecurringConflictError, RecurringValidationError } from '@/features/recurring/recurring.errors';
import * as recurring from '@/features/recurring/recurring.service';
import { getReportSummary } from '@/features/reports/reports.service';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';
import { getRecurringProvenance } from '@/features/recurring/recurring.service';
import { getMonthRange } from '@/utils/date-range';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase } from '../support/test-database';

import {
  buildRecurringFixture,
  createGroceryRun,
  createRent,
  createSalary,
  rupees,
  type RecurringFixture,
} from './fixture';

/**
 * What the recurring screens show and do, asserted through the one service and
 * one presentation module each screen is a thin arrangement of. The layout is
 * not asserted; every figure, word, and state transition a screen depends on is.
 */

const AS_OF = '2026-09-20';
let fixture: RecurringFixture;

function dueDates(options: { asOfDate?: string; templateId?: number } = {}) {
  return recurring
    .listDueOccurrences({ asOfDate: options.asOfDate ?? AS_OF, templateId: options.templateId })
    .occurrences.map((item) => item.occurrenceDate);
}

describe('recurring screens', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  describe('main screen', () => {
    it('shows an empty state with nothing due', () => {
      expect(recurring.listRecurringTemplates()).toEqual([]);
      const home = recurring.getRecurringHomeSummary({ asOfDate: AS_OF });
      expect(home).toMatchObject({ dueCount: 0, hasMore: false, preview: [] });
    });

    it('separates active and paused templates, each with its status in words', () => {
      const rent = createRent(fixture);
      const grocery = createGroceryRun(fixture);
      recurring.pauseRecurringTemplate(grocery.id);

      const views = recurring.listRecurringTemplates();
      const active = views.filter((view) => !view.isPaused);
      const paused = views.filter((view) => view.isPaused);

      expect(active.map((view) => view.id)).toEqual([rent.id]);
      expect(paused.map((view) => view.id)).toEqual([grocery.id]);
      expect(getTemplateStatusLabel(active[0]!)).toBe('Active');
      expect(getTemplateStatusLabel(paused[0]!)).toBe('Paused');
      expect(templateLabel(active[0]!)).toBe('Rent');
    });

    it('takes next due from the engine, not from the UI', () => {
      createSalary(fixture);
      const view = recurring.listRecurringTemplates()[0]!;
      // Salary starts 2026-06-01; the earliest unhandled date is the first.
      expect(view.nextDueDate).toBe('2026-06-01');
      expect(getNextDueLabel(view, AS_OF)).toBe('Due Jun 1');
    });
  });

  describe('due screen', () => {
    it('lists every due date oldest first, and excludes the future', () => {
      createSalary(fixture); // monthly from 2026-06-01
      expect(dueDates()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
      // Nothing past the as-of date.
      expect(dueDates({ asOfDate: '2026-07-10' })).toEqual(['2026-06-01', '2026-07-01']);
    });

    it('names each due occurrence from the template', () => {
      createSalary(fixture);
      const occurrence = recurring.listDueOccurrences({ asOfDate: AS_OF }).occurrences[0]!;
      expect(dueLabel(occurrence)).toBe('Salary');
      expect(occurrence.type).toBe('income');
    });
  });

  describe('generate', () => {
    it('creates a transaction on the scheduled date and clears the due row', () => {
      const salary = createSalary(fixture);
      const bankBefore = getAccountBalance(fixture.bank.id);
      const countBefore = transactionService.listTransactions().length;

      const result = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(result.outcome).toBe('generated');
      expect(result.transactionId).not.toBeNull();

      // The due row is gone, the transaction exists, the balance moved.
      expect(dueDates()).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
      expect(transactionService.listTransactions().length).toBe(countBefore + 1);
      expect(getAccountBalance(fixture.bank.id)).toBe(bankBefore + rupees(65_000));

      const generated = transactionService.getTransactionView(result.transactionId!);
      // Dated its scheduled day, not today.
      expect(generated.recurringOccurrenceId).toBe(result.occurrence.id);
      expect(generated.transactionDate.getFullYear()).toBe(2026);
      expect(generated.transactionDate.getMonth()).toBe(5); // June
      expect(generated.transactionDate.getDate()).toBe(1);
    });

    it('is idempotent — a second generate returns the same transaction', () => {
      const salary = createSalary(fixture);
      const first = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      const second = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(second.outcome).toBe('already_generated');
      expect(second.transactionId).toBe(first.transactionId);
      expect(transactionService.listTransactions().length).toBe(1);
    });

    it('exposes provenance on the generated transaction only', () => {
      const salary = createSalary(fixture);
      const result = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      const provenance = getRecurringProvenance(result.occurrence.id);
      expect(provenance).toMatchObject({ occurrenceDate: '2026-06-01', label: 'Salary' });

      // A hand-entered transaction carries no occurrence, hence no provenance.
      const manual = transactionService.createIncome({
        amountMinor: rupees(100),
        categoryId: fixture.salary.id,
        accountId: fixture.bank.id,
        transactionDate: new Date(),
      });
      expect(transactionService.getTransactionView(manual.id).recurringOccurrenceId).toBeNull();
    });
  });

  describe('skip', () => {
    it('clears the due row and creates no transaction', () => {
      const salary = createSalary(fixture);
      const countBefore = transactionService.listTransactions().length;
      recurring.skipOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });

      expect(dueDates()).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
      expect(transactionService.listTransactions().length).toBe(countBefore);
    });

    it('differs from pause: it sets aside one date, not the whole schedule', () => {
      const salary = createSalary(fixture);
      recurring.skipOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      // Later dates are still due.
      expect(dueDates()).toContain('2026-07-01');
    });
  });

  describe('pause and resume', () => {
    it('removes a paused template from the due list but keeps its dates outstanding', () => {
      const salary = createSalary(fixture);
      recurring.pauseRecurringTemplate(salary.id);
      expect(dueDates()).toEqual([]);

      const outstanding = recurring.countOutstandingOccurrences(salary.id, { asOfDate: AS_OF });
      expect(outstanding.count).toBe(4);
      expect(outstanding.hasMore).toBe(false);
    });

    it('makes missed dates due again on resume', () => {
      const salary = createSalary(fixture);
      recurring.pauseRecurringTemplate(salary.id);
      recurring.resumeRecurringTemplate(salary.id);
      expect(dueDates()).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
    });
  });

  describe('edit', () => {
    it('changes future generation only, never a transaction already generated', () => {
      const salary = createSalary(fixture);
      const first = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      const originalAmount = transactionService.getTransaction(first.transactionId!)!.amountMinor;

      recurring.updateRecurringTemplate(salary.id, { amountMinor: rupees(70_000) });

      // The already-generated transaction is untouched.
      expect(transactionService.getTransaction(first.transactionId!)!.amountMinor).toBe(
        originalAmount,
      );
      // A newly generated date uses the new amount.
      const next = recurring.generateOccurrence(salary.id, '2026-07-01', { asOfDate: AS_OF });
      expect(transactionService.getTransaction(next.transactionId!)!.amountMinor).toBe(
        rupees(70_000),
      );
    });

    it('locks the schedule once a date has been handled', () => {
      const salary = createSalary(fixture);
      recurring.skipOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(() => recurring.updateRecurringTemplate(salary.id, { frequency: 'weekly' })).toThrow(
        RecurringConflictError,
      );
      // A non-schedule edit still works.
      expect(() =>
        recurring.updateRecurringTemplate(salary.id, { amountMinor: rupees(1) }),
      ).not.toThrow();
    });
  });

  describe('delete', () => {
    it('stops future due dates but keeps transactions already generated', () => {
      const salary = createSalary(fixture);
      const result = recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      recurring.deleteRecurringTemplate(salary.id);

      expect(recurring.listRecurringTemplates()).toEqual([]);
      expect(dueDates()).toEqual([]);
      // The generated transaction remains.
      expect(transactionService.getTransaction(result.transactionId!)).not.toBeNull();
    });
  });

  describe('blocked occurrences', () => {
    it('keeps a blocked date due and reports why, never auto-skipping it', () => {
      const rent = createRent(fixture); // uses the bank account
      accountService.archiveAccount(fixture.bank.id);

      const due = recurring.listDueOccurrences({ asOfDate: AS_OF, templateId: rent.id });
      expect(due.occurrences.length).toBeGreaterThan(0);
      expect(due.occurrences.every((item) => item.blockedReason === 'account_archived')).toBe(true);

      // Generating a blocked date is refused; the date stays due.
      expect(() =>
        recurring.generateOccurrence(rent.id, due.occurrences[0]!.occurrenceDate, {
          asOfDate: AS_OF,
        }),
      ).toThrow(RecurringValidationError);
      expect(recurring.listDueOccurrences({ asOfDate: AS_OF, templateId: rent.id }).occurrences.length).toBe(
        due.occurrences.length,
      );
    });
  });

  describe('already-handled races', () => {
    it('refuses to generate a skipped date', () => {
      const salary = createSalary(fixture);
      recurring.skipOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(() =>
        recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF }),
      ).toThrow(RecurringConflictError);
    });

    it('refuses to skip a generated date', () => {
      const salary = createSalary(fixture);
      recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(() => recurring.skipOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF })).toThrow(
        RecurringConflictError,
      );
    });
  });

  describe('generate all', () => {
    it('generates every generatable date and reports a count summary', () => {
      createSalary(fixture); // 4 due
      const result = recurring.generateDueOccurrences({ asOfDate: AS_OF });
      expect(result.generated.length).toBe(4);
      expect(describeGenerateDueResult(result)).toBe('4 generated');
      expect(dueDates()).toEqual([]);
    });

    it('leaves a blocked date due while generating the rest', () => {
      const salary = createSalary(fixture);
      const dollarsSalary = createSalary(fixture, {
        accountId: fixture.dollars.id,
        title: 'USD Salary',
      });
      accountService.archiveAccount(fixture.dollars.id);

      const result = recurring.generateDueOccurrences({ asOfDate: AS_OF });
      expect(result.generated.every((item) => item.templateId === salary.id)).toBe(true);
      expect(result.blocked.every((item) => item.templateId === dollarsSalary.id)).toBe(true);
      expect(result.blocked.length).toBeGreaterThan(0);
      // The blocked template's dates are still due.
      expect(dueDates({ templateId: dollarsSalary.id }).length).toBe(result.blocked.length);
    });
  });

  describe('home and accounting invariance', () => {
    it('does not move any accounting figure until a date is generated', () => {
      const bankBefore = getAccountBalance(fixture.bank.id);
      const salary = createSalary(fixture);
      // The template alone changes nothing.
      expect(getAccountBalance(fixture.bank.id)).toBe(bankBefore);

      const home = recurring.getRecurringHomeSummary({ asOfDate: AS_OF });
      expect(home.dueCount).toBe(4);
      expect(home.preview.length).toBe(3);

      recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      expect(getAccountBalance(fixture.bank.id)).toBe(bankBefore + rupees(65_000));
      expect(recurring.getRecurringHomeSummary({ asOfDate: AS_OF }).dueCount).toBe(3);
    });
  });

  describe('history', () => {
    it('records what happened to each handled date, newest first', () => {
      const salary = createSalary(fixture);
      recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      recurring.skipOccurrence(salary.id, '2026-07-01', { asOfDate: AS_OF });

      const history = recurring.listTemplateHistory(salary.id);
      expect(history.map((item) => item.occurrenceDate)).toEqual(['2026-07-01', '2026-06-01']);
      expect(getHistoryEntryLabel(history[0]!)).toBe('Jul 1 — Skipped');
      expect(getHistoryEntryLabel(history[1]!)).toBe('Jun 1 — Generated');
      expect(history[1]!.transactionId).not.toBeNull();
    });
  });

  describe('budget and reports interaction', () => {
    it('affects a budget and reports only once the expense is generated, on its scheduled month', () => {
      const rent = createRent(fixture); // bills, 20,000, monthly from Jan 31
      budgetService.createBudget({
        categoryId: fixture.bills.id,
        periodMonth: '2026-08',
        amountMinor: rupees(25_000),
        currency: 'NPR',
      });

      const before = budgetService.getMonthlyBudgetSummary('2026-08');
      const billsBefore = before.categoryBudgets.find((b) => b.budget.categoryId === fixture.bills.id);
      expect(billsBefore?.spentMinor).toBe(0);
      expect(getReportSummary(getMonthRange(2026, 7)).expenseMinor).toBe(0); // August = month index 7

      recurring.generateOccurrence(rent.id, '2026-08-31', { asOfDate: AS_OF });

      const after = budgetService.getMonthlyBudgetSummary('2026-08');
      const billsAfter = after.categoryBudgets.find((b) => b.budget.categoryId === fixture.bills.id);
      expect(billsAfter?.spentMinor).toBe(rupees(20_000));
      expect(getReportSummary(getMonthRange(2026, 7)).expenseMinor).toBe(rupees(20_000));
      // A later month the date does not belong to is unaffected.
      expect(getReportSummary(getMonthRange(2026, 8)).expenseMinor).toBe(0); // September
    });
  });

  describe('offline and sync', () => {
    it('queues recurring mutations as pending changes, with no network', () => {
      const before = countPendingSyncMutations();
      const salary = createSalary(fixture);
      expect(countPendingSyncMutations()).toBeGreaterThan(before);

      const afterCreate = countPendingSyncMutations();
      recurring.generateOccurrence(salary.id, '2026-06-01', { asOfDate: AS_OF });
      // Generating queues the occurrence and the transaction it produced.
      expect(countPendingSyncMutations()).toBeGreaterThan(afterCreate);
    });
  });
});
