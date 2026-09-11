import { describe, expect, it } from 'vitest';

import { RecurringConflictError, RecurringValidationError } from '@/features/recurring/recurring.errors';
import {
  ALREADY_HANDLED_MESSAGE,
  describeBlockedOccurrence,
  describeGenerateDueResult,
  describeRecurrence,
  dueLabel,
  formatScheduledLong,
  formatScheduledShort,
  formatScheduledSpoken,
  frequencyLabel,
  frequencyUnit,
  getBlockedReasonShort,
  getDueAccessibilityLabel,
  getDueTimingLabel,
  getGenerateActionLabel,
  getGenerateAllConfirmation,
  getHistoryEntryLabel,
  getNextDueLabel,
  getProvenanceDetail,
  getProvenanceLabel,
  getScheduleExplanation,
  getSkipActionLabel,
  getSkipConfirmationMessage,
  getTemplateAccessibilityLabel,
  getTemplateStatusLabel,
  isAlreadyHandledError,
  isOverdue,
  recurringTypeDirection,
  recurringTypeLabel,
  templateLabel,
} from '@/features/recurring/recurring-presentation';
import type {
  DueRecurringOccurrence,
  GenerateDueResult,
  RecurringTemplateView,
} from '@/features/recurring/recurring.types';

/**
 * The words a recurring screen shows, asserted where a test can reach them.
 *
 * The screens are a thin arrangement of the engine and this module, so what a
 * test cannot assert through a rendered tree — the layout — is asserted here:
 * every schedule phrase, every overdue label, every spoken row.
 */

function dueOccurrence(overrides: Partial<DueRecurringOccurrence> = {}): DueRecurringOccurrence {
  return {
    templateId: 1,
    templateSyncId: 'sync-1',
    occurrenceDate: '2026-09-30',
    type: 'expense',
    amountMinor: 20_000_00,
    currency: 'NPR',
    categoryId: 2,
    categoryName: 'Bills',
    categoryIcon: 'receipt',
    accountId: 3,
    accountName: 'Bank',
    title: 'Rent',
    blockedReason: null,
    ...overrides,
  };
}

function templateView(overrides: Partial<RecurringTemplateView> = {}): RecurringTemplateView {
  return {
    id: 1,
    type: 'expense',
    amountMinor: 20_000_00,
    currency: 'NPR',
    categoryId: 2,
    accountId: 3,
    paymentMode: null,
    title: 'Rent',
    note: null,
    startDate: '2026-01-31',
    frequency: 'monthly',
    interval: 1,
    endDate: null,
    isPaused: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    syncId: 'sync-1',
    deletedAt: null,
    categoryName: 'Bills',
    categoryIcon: 'receipt',
    accountName: 'Bank',
    nextDueDate: '2026-10-31',
    handledCount: 0,
    ...overrides,
  };
}

describe('recurring date formatting', () => {
  it('formats a local date without drifting across time zones', () => {
    expect(formatScheduledShort('2026-09-30')).toBe('Sep 30');
    expect(formatScheduledLong('2026-09-30')).toBe('September 30, 2026');
    expect(formatScheduledSpoken('2026-08-31')).toBe('August 31');
    // The first of the month is the boundary a UTC conversion would push to the
    // previous day; it must stay the 1st.
    expect(formatScheduledShort('2026-09-01')).toBe('Sep 1');
  });
});

describe('recurrence phrasing', () => {
  it('reads as a sentence at every interval', () => {
    expect(describeRecurrence('daily', 1)).toBe('Every day');
    expect(describeRecurrence('daily', 3)).toBe('Every 3 days');
    expect(describeRecurrence('weekly', 1)).toBe('Every week');
    expect(describeRecurrence('weekly', 2)).toBe('Every 2 weeks');
    expect(describeRecurrence('monthly', 1)).toBe('Every month');
    expect(describeRecurrence('monthly', 3)).toBe('Every 3 months');
    expect(describeRecurrence('yearly', 1)).toBe('Every year');
  });

  it('names the unit for an interval control', () => {
    expect(frequencyUnit('weekly', 1)).toBe('week');
    expect(frequencyUnit('weekly', 2)).toBe('weeks');
    expect(frequencyLabel('monthly')).toBe('Monthly');
  });

  it('explains end-of-month clamping without contradicting the engine', () => {
    const explanation = getScheduleExplanation({ frequency: 'monthly', startDate: '2026-01-31' });
    expect(explanation).toContain('31st');
    expect(explanation).toContain('last day of shorter months');
  });

  it('explains leap-day clamping', () => {
    const explanation = getScheduleExplanation({ frequency: 'yearly', startDate: '2028-02-29' });
    expect(explanation).toContain('February 28');
  });

  it('says nothing about an ordinary monthly date', () => {
    expect(getScheduleExplanation({ frequency: 'monthly', startDate: '2026-06-15' })).toBeNull();
  });
});

describe('type and label', () => {
  it('names the type in words and direction for colour', () => {
    expect(recurringTypeLabel('expense')).toBe('Expense');
    expect(recurringTypeLabel('income')).toBe('Income');
    expect(recurringTypeDirection('expense')).toBe('expense');
  });

  it('falls back from title to category to type, never to blank', () => {
    expect(templateLabel({ title: 'Rent', categoryName: 'Bills', type: 'expense' })).toBe('Rent');
    expect(templateLabel({ title: '  ', categoryName: 'Bills', type: 'expense' })).toBe('Bills');
    expect(templateLabel({ title: '', categoryName: null, type: 'income' })).toBe('Income');
    expect(dueLabel(dueOccurrence({ title: '' }))).toBe('Bills');
  });
});

describe('due timing and next due', () => {
  it('calls a passed date overdue and today due today', () => {
    expect(getDueTimingLabel('2026-09-20', '2026-09-20')).toBe('Due today');
    expect(getDueTimingLabel('2026-08-31', '2026-09-20')).toBe('Overdue');
    expect(isOverdue('2026-08-31', '2026-09-20')).toBe(true);
    expect(isOverdue('2026-09-20', '2026-09-20')).toBe(false);
  });

  it('shows the next date as upcoming or already due', () => {
    expect(getNextDueLabel(templateView({ nextDueDate: '2026-10-31' }), '2026-09-20')).toBe(
      'Next Oct 31',
    );
    expect(getNextDueLabel(templateView({ nextDueDate: '2026-09-15' }), '2026-09-20')).toBe(
      'Due Sep 15',
    );
    expect(getNextDueLabel(templateView({ nextDueDate: null }), '2026-09-20')).toBeNull();
  });

  it('states status in words', () => {
    expect(getTemplateStatusLabel(templateView({ isPaused: true }))).toBe('Paused');
    expect(getTemplateStatusLabel(templateView({ nextDueDate: null }))).toBe('Ended');
    expect(getTemplateStatusLabel(templateView())).toBe('Active');
  });
});

describe('blocked occurrences', () => {
  it('gives a short chip and a full sentence for each reason', () => {
    expect(getBlockedReasonShort('account_archived')).toBe('Account archived');
    expect(getBlockedReasonShort('category_deleted')).toBe('Category removed');
    expect(describeBlockedOccurrence('account_archived')).toContain('archived account');
    expect(describeBlockedOccurrence('currency_mismatch')).toContain('different currency');
  });
});

describe('accessibility labels', () => {
  it('reads a template row in full', () => {
    const label = getTemplateAccessibilityLabel(templateView(), '2026-09-20');
    expect(label).toContain('Rent');
    expect(label).toContain('recurring expense');
    expect(label).toContain('NPR 20,000.00');
    expect(label).toContain('from Bank');
    expect(label).toContain('every month');
    expect(label).toContain('next due October 31');
  });

  it('marks a paused template as paused rather than due', () => {
    const label = getTemplateAccessibilityLabel(templateView({ isPaused: true }), '2026-09-20');
    expect(label).toContain('paused');
    expect(label).not.toContain('next due');
  });

  it('reads a due row with its date and any blocked reason', () => {
    const label = getDueAccessibilityLabel(
      dueOccurrence({ occurrenceDate: '2026-08-31', blockedReason: 'account_archived' }),
      '2026-09-20',
    );
    expect(label).toContain('Rent');
    expect(label).toContain('overdue August 31');
    expect(label).toContain('needs attention');
  });

  it('labels the generate and skip actions with name and date', () => {
    const occurrence = dueOccurrence({ occurrenceDate: '2026-09-30' });
    expect(getGenerateActionLabel(occurrence)).toBe('Generate Rent for September 30');
    expect(getSkipActionLabel(occurrence)).toBe('Skip Rent for September 30');
  });
});

describe('confirmations and batch summaries', () => {
  it('spells out what a skip does and does not do', () => {
    const message = getSkipConfirmationMessage(dueOccurrence({ occurrenceDate: '2026-09-30' }));
    expect(message).toContain('No transaction will be created for September 30');
  });

  it('confirms a batch by count, never a combined total', () => {
    expect(getGenerateAllConfirmation(1)).toBe('Generate the 1 due transaction now?');
    expect(getGenerateAllConfirmation(5)).toContain('5 due transactions');
  });

  it('summarises a batch result by count', () => {
    const result: GenerateDueResult = {
      generated: [
        { templateId: 1, occurrenceDate: '2026-07-31', transactionId: 10 },
        { templateId: 1, occurrenceDate: '2026-08-31', transactionId: 11 },
      ],
      alreadyHandled: [{ templateId: 2, occurrenceDate: '2026-09-01', status: 'generated' }],
      blocked: [{ templateId: 3, occurrenceDate: '2026-09-15', reason: 'account_archived' }],
      failed: [],
      hasMore: false,
    };
    expect(describeGenerateDueResult(result)).toBe(
      '2 generated · 1 already handled · 1 needs attention',
    );
    expect(
      describeGenerateDueResult({
        generated: [],
        alreadyHandled: [],
        blocked: [],
        failed: [],
        hasMore: false,
      }),
    ).toBe('Nothing to generate.');
  });
});

describe('history and provenance', () => {
  it('labels a handled date', () => {
    expect(
      getHistoryEntryLabel({ occurrenceDate: '2026-09-01', status: 'generated', transactionId: 5 }),
    ).toBe('Sep 1 — Generated');
    expect(
      getHistoryEntryLabel({ occurrenceDate: '2026-07-01', status: 'skipped', transactionId: null }),
    ).toBe('Jul 1 — Skipped');
  });

  it('states where a generated transaction came from and which date it stands for', () => {
    expect(getProvenanceLabel()).toBe('Created from a recurring transaction');
    expect(
      getProvenanceDetail({
        occurrenceDate: '2026-08-31',
        type: 'expense',
        label: 'Rent',
        templateDeleted: false,
      }),
    ).toBe('Scheduled for August 31, 2026');
  });
});

describe('error classification', () => {
  it('treats an already-handled conflict as a reason to reload, not to alarm', () => {
    expect(isAlreadyHandledError(new RecurringConflictError('occurrence_already_skipped', 'x'))).toBe(
      true,
    );
    expect(
      isAlreadyHandledError(new RecurringConflictError('occurrence_already_generated', 'x')),
    ).toBe(true);
    expect(isAlreadyHandledError(new RecurringConflictError('template_paused', 'x'))).toBe(false);
    expect(isAlreadyHandledError(new RecurringValidationError('account_archived', 'x'))).toBe(false);
    expect(isAlreadyHandledError(new Error('boom'))).toBe(false);
    expect(ALREADY_HANDLED_MESSAGE).toContain('already been handled');
  });
});
