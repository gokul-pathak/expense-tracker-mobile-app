import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import * as budgetService from '@/features/budgets/budget.service';
import * as recurring from '@/features/recurring/recurring.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  buildRecurringFixture,
  createRent,
  rupees,
  type RecurringFixture,
} from '../recurring/fixture';
import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * The M8E additions to the local integrity audit.
 *
 * Every state below is one the app's own write paths cannot produce: generation
 * is atomic, the schedule locks once a date is handled, and both databases carry
 * unique indexes over the pairs that matter. They are reachable only through a
 * half-applied migration, a database edited outside the app, or a restored file
 * from another build — which is the whole reason an audit exists.
 *
 * The audit reports and never repairs, so each test also proves the broken row
 * is still there afterwards, or that a legitimate state is left alone.
 */

const AS_OF = '2026-09-12';

let fixture: RecurringFixture;

function codes() {
  return verifySyncIntegrity().issues.map((issue) => issue.code);
}

/** Injection needs the schema's own guard rails out of the way. */
function withoutChecks(run: () => void): void {
  const client = rawClient();
  client.exec('PRAGMA ignore_check_constraints = ON');
  try {
    run();
  } finally {
    client.exec('PRAGMA ignore_check_constraints = OFF');
  }
}

describe('the audit and recurring data', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('passes a database holding templates, decisions and generated money', () => {
    const template = createRent(fixture);
    recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    recurring.skipOccurrence(template.id, '2026-02-28', { asOfDate: AS_OF });
    budgetService.createBudget({ periodMonth: '2026-09', amountMinor: rupees(40_000) });

    const report = verifySyncIntegrity();
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('names a generated occurrence whose transaction was never written', () => {
    const template = createRent(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    // Generation is one SQLite transaction, so this is the shape of an
    // atomicity failure: the decision without the money.
    rawClient().exec(
      `DELETE FROM transactions WHERE recurring_occurrence_id = ${generated.occurrence.id}`,
    );

    const report = verifySyncIntegrity();
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      code: 'recurring_generated_without_transaction',
      entityType: 'recurring_occurrence',
      count: 1,
    });
    // Reported, not repaired: the occurrence is left exactly as it was.
    expect(recurring.listTemplateHistory(template.id)[0]?.status).toBe('generated');
  });

  it('stays quiet when the user simply deleted the generated transaction', () => {
    const template = createRent(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });

    transactionService.deleteTransaction(generated.transactionId!);

    // The tombstoned row still proves generation completed, and M8C keeps the
    // date handled rather than offering it again.
    expect(verifySyncIntegrity().issues).toEqual([]);
    expect(
      recurring.listDueOccurrences({ asOfDate: AS_OF }).occurrences.map((o) => o.occurrenceDate),
    ).not.toContain('2026-01-31');
  });

  it('names a skipped date that nonetheless moved money', () => {
    const template = createRent(fixture);
    const skipped = recurring.skipOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    const manual = transactionService.createExpense({
      accountId: fixture.bank.id,
      categoryId: fixture.bills.id,
      amountMinor: rupees(20_000),
      title: 'Rent',
      transactionDate: new Date(2026, 0, 31, 12),
    });
    rawClient().exec(
      `UPDATE transactions SET recurring_occurrence_id = ${skipped.occurrence.id} WHERE id = ${manual.id}`,
    );

    expect(codes()).toContain('recurring_skipped_with_transaction');
  });

  it('names a decision about a date the template never lands on', () => {
    const template = createRent(fixture); // Monthly, anchored to the 31st.
    const generated = recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    rawClient().exec(
      `UPDATE recurring_occurrences SET occurrence_date = '2026-01-15' WHERE id = ${generated.occurrence.id}`,
    );

    expect(codes()).toContain('recurring_occurrence_unscheduled_date');
  });

  it('names two decisions about one date on a database that lost its index', () => {
    const template = createRent(fixture);
    recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    rawClient().exec('DROP INDEX uq_recurring_occurrence_template_date');
    rawClient().exec(
      `INSERT INTO recurring_occurrences (template_id, occurrence_date, status, created_at, updated_at, sync_id)
       VALUES (${template.id}, '2026-01-31', 'skipped', 1, 1, '33333333-3333-4333-8333-333333333333')`,
    );

    expect(codes()).toContain('recurring_occurrence_duplicate_date');
  });

  it('names a status that is neither generated nor skipped', () => {
    const template = createRent(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    withoutChecks(() => {
      rawClient().exec(
        `UPDATE recurring_occurrences SET status = 'pending' WHERE id = ${generated.occurrence.id}`,
      );
    });

    expect(codes()).toContain('recurring_occurrence_invalid_status');
  });

  it('names a template whose category is of the wrong type for it', () => {
    const template = createRent(fixture);
    rawClient().exec(
      `UPDATE recurring_templates SET category_id = ${fixture.salary.id} WHERE id = ${template.id}`,
    );

    expect(codes()).toContain('recurring_template_invalid_relation');
  });

  it('leaves an archived account alone, because a blocked template is a real state', () => {
    const template = createRent(fixture);
    recurring.generateOccurrence(template.id, '2026-01-31', { asOfDate: AS_OF });
    rawClient().exec(`UPDATE accounts SET is_archived = 1 WHERE id = ${fixture.bank.id}`);

    // The template stays, its next date is reported as blocked, and none of
    // that is a corruption.
    expect(verifySyncIntegrity().issues).toEqual([]);
  });
});

describe('the audit and budget currency', () => {
  beforeEach(async () => {
    await setupDatabase();
    fixture = buildRecurringFixture();
  });

  it('names a currency that no expense could ever match', () => {
    const budget = budgetService.createBudget({
      periodMonth: '2026-09',
      amountMinor: rupees(40_000),
    });
    rawClient().exec(`UPDATE budgets SET currency = ' npr' WHERE id = ${budget.id}`);

    const report = verifySyncIntegrity();
    expect(report.issues).toContainEqual({
      code: 'budget_invalid_currency',
      entityType: 'budget',
      count: 1,
    });
    // Still there: which currency was meant is a question for a person.
    expect(budgetService.getBudget(budget.id).currency).toBe(' npr');
  });
});
