import type {
  RecurringFrequency,
  RecurringOccurrenceStatus,
  RecurringTransactionType,
} from '@/db/constants';
import { formatMinorUnits } from '@/utils/money';

import { parseLocalDate, type LocalDate } from './recurring-schedule';
import { RecurringConflictError } from './recurring.errors';
import type {
  DueRecurringOccurrence,
  GenerateDueResult,
  OccurrenceHistoryItem,
  RecurringBlockedReason,
  RecurringProvenance,
  RecurringTemplateView,
} from './recurring.types';

/**
 * How a recurring template and its due dates read, kept apart from how they are
 * drawn.
 *
 * Every string a recurring screen shows comes from here. The screens are not
 * testable in this suite — the runner only collects `.ts` — so anything with a
 * rule in it (a schedule summary, an overdue label, a spoken row) has to live
 * where a test can reach it. The recurrence arithmetic stays in
 * `recurring-schedule.ts`; this file only formats, never computes a date.
 *
 * The register is the app's: factual, never advisory. "Overdue" is a statement
 * of fact about a date that has passed, not a nudge.
 */

const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat('en-US', { month: 'long' });

/**
 * A scheduled date as a local `Date` at noon, purely so `Intl` can name its
 * month. The day, month and year are read straight from the `YYYY-MM-DD` text;
 * the instant is never compared or stored, so there is no time-zone drift.
 */
function civilDate(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  return new Date(year, month - 1, day, 12);
}

/** "Sep 30" — no year, for a row where the context is already this year's dates. */
export function formatScheduledShort(date: LocalDate): string {
  const { day } = parseLocalDate(date);
  return MONTH_SHORT.format(civilDate(date)) + ' ' + day;
}

/** "September 30, 2026" — the unambiguous form, for detail screens and spoken labels. */
export function formatScheduledLong(date: LocalDate): string {
  const { year, day } = parseLocalDate(date);
  return MONTH_LONG.format(civilDate(date)) + ' ' + day + ', ' + year;
}

/** "September 30" — named month and day, no year, for spoken labels inside one year's list. */
export function formatScheduledSpoken(date: LocalDate): string {
  const { day } = parseLocalDate(date);
  return MONTH_LONG.format(civilDate(date)) + ' ' + day;
}

export function recurringTypeLabel(type: RecurringTransactionType): string {
  return type === 'expense' ? 'Expense' : 'Income';
}

/** Money direction for colour and sign: an expense is out, an income is in. */
export function recurringTypeDirection(type: RecurringTransactionType): 'expense' | 'income' {
  return type;
}

/**
 * The name a template shows: its own title, the category it records against, or,
 * failing both, simply what kind of thing it is. A title is optional, so a blank
 * one must never render as an empty row.
 */
export function templateLabel(template: {
  title: string;
  categoryName: string | null;
  type: RecurringTransactionType;
}): string {
  const title = template.title.trim();
  if (title) return title;
  if (template.categoryName) return template.categoryName;
  return recurringTypeLabel(template.type);
}

/** The name a due occurrence shows. Same rule as a template, without a category fallback gap. */
export function dueLabel(occurrence: DueRecurringOccurrence): string {
  const title = occurrence.title.trim();
  if (title) return title;
  if (occurrence.categoryName) return occurrence.categoryName;
  return recurringTypeLabel(occurrence.type);
}

/**
 * The schedule in one phrase: "Every day", "Every 2 weeks", "Every month",
 * "Every 3 months", "Every year". Centralised so the list, the detail screen
 * and the form's live summary cannot word it three different ways.
 */
export function describeRecurrence(frequency: RecurringFrequency, interval: number): string {
  const unit = UNIT[frequency];
  if (interval <= 1) return 'Every ' + unit.singular;
  return 'Every ' + interval + ' ' + unit.plural;
}

const UNIT: Record<RecurringFrequency, { singular: string; plural: string }> = {
  daily: { singular: 'day', plural: 'days' },
  weekly: { singular: 'week', plural: 'weeks' },
  monthly: { singular: 'month', plural: 'months' },
  yearly: { singular: 'year', plural: 'years' },
};

/** The unit word for an interval control: "day"/"days", "week"/"weeks", … */
export function frequencyUnit(frequency: RecurringFrequency, count: number): string {
  const unit = UNIT[frequency];
  return count === 1 ? unit.singular : unit.plural;
}

/** "Daily"/"Weekly"/"Monthly"/"Yearly", for a frequency picker's option labels. */
export function frequencyLabel(frequency: RecurringFrequency): string {
  switch (frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'yearly':
      return 'Yearly';
  }
}

/**
 * The non-obvious part of a schedule, spelled out, or null when there is none.
 *
 * A monthly date on the 29th, 30th or 31st lands on the last day of a shorter
 * month; a yearly February 29 lands on the 28th in common years. The engine
 * already does this (it computes from the start date and clamps), but the
 * behaviour surprises people, so the screens that set a schedule say it plainly.
 */
export function getScheduleExplanation(template: {
  frequency: RecurringFrequency;
  startDate: LocalDate;
}): string | null {
  const { month, day } = parseLocalDate(template.startDate);
  if (template.frequency === 'monthly' && day >= 29) {
    return (
      'Falls on the ' +
      ordinal(day) +
      ' each month, or the last day of shorter months, so February is not skipped.'
    );
  }
  if (template.frequency === 'yearly' && month === 2 && day === 29) {
    return 'Falls on February 29. In non-leap years it occurs on February 28.';
  }
  return null;
}

/**
 * What to put where a row shows "when next". Null once the schedule has ended
 * and every date is handled; "Due <date>" when the next date has already
 * arrived and is outstanding; "Next <date>" when it is still ahead.
 */
export function getNextDueLabel(view: RecurringTemplateView, asOfDate: LocalDate): string | null {
  if (view.nextDueDate === null) return null;
  if (view.nextDueDate <= asOfDate) return 'Due ' + formatScheduledShort(view.nextDueDate);
  return 'Next ' + formatScheduledShort(view.nextDueDate);
}

/** Paused, active, or ended — in words, because colour and position alone do not carry it. */
export function getTemplateStatusLabel(view: RecurringTemplateView): string {
  if (view.isPaused) return 'Paused';
  if (view.nextDueDate === null) return 'Ended';
  return 'Active';
}

/**
 * How a due date reads relative to today. A due list never contains a future
 * date, so the only two outcomes are that the date is today or that it has
 * passed. Factual wording: a missed rent payment is "Overdue", never "Late!".
 */
export function getDueTimingLabel(occurrenceDate: LocalDate, asOfDate: LocalDate): string {
  if (occurrenceDate >= asOfDate) return 'Due today';
  return 'Overdue';
}

export function isOverdue(occurrenceDate: LocalDate, asOfDate: LocalDate): boolean {
  return occurrenceDate < asOfDate;
}

/** A short chip for a blocked due date — what is wrong, in three words. */
export function getBlockedReasonShort(reason: RecurringBlockedReason): string {
  switch (reason) {
    case 'account_archived':
      return 'Account archived';
    case 'account_deleted':
      return 'Account removed';
    case 'category_deleted':
      return 'Category removed';
    case 'category_type_mismatch':
      return 'Category mismatch';
    case 'currency_mismatch':
      return 'Currency changed';
  }
}

/**
 * The full sentence for a blocked due date, naming what to fix and offering the
 * way out. The wording mirrors the engine's own `describeBlockedReason` but is
 * addressed to someone looking at the Due screen, where the fix is to edit the
 * template or skip the date.
 */
export function describeBlockedOccurrence(reason: RecurringBlockedReason): string {
  switch (reason) {
    case 'account_archived':
      return 'This recurring transaction uses an archived account. Choose an active account before generating it.';
    case 'account_deleted':
      return 'This recurring transaction’s account no longer exists. Choose an active account before generating it.';
    case 'category_deleted':
      return 'This recurring transaction’s category no longer exists. Choose an active category before generating it.';
    case 'category_type_mismatch':
      return 'This recurring transaction’s category no longer matches its type. Choose another category before generating it.';
    case 'currency_mismatch':
      return 'This recurring transaction’s account now uses a different currency. Update the template before generating it.';
  }
}

// Accessibility -----------------------------------------------------------

/**
 * One template row read aloud in full: what it is, its amount and account, its
 * schedule, and when it is next due or that it is paused. A screen reader reaches
 * the row as a single element, so the label carries everything the layout shows.
 */
export function getTemplateAccessibilityLabel(
  view: RecurringTemplateView,
  asOfDate: LocalDate,
): string {
  const parts = [
    templateLabel(view),
    'recurring ' + view.type,
    formatMinorUnits(view.amountMinor, view.currency),
    view.accountName ? 'from ' + view.accountName : '',
    describeRecurrence(view.frequency, view.interval).toLowerCase(),
  ].filter(Boolean);

  if (view.isPaused) {
    parts.push('paused');
  } else if (view.nextDueDate !== null) {
    const when = view.nextDueDate <= asOfDate ? 'due ' : 'next due ';
    parts.push(when + formatScheduledSpoken(view.nextDueDate));
  } else {
    parts.push('ended');
  }
  return parts.join(', ') + '.';
}

/** One due row read aloud: what it is, its amount, its date, and any reason it is blocked. */
export function getDueAccessibilityLabel(
  occurrence: DueRecurringOccurrence,
  asOfDate: LocalDate,
): string {
  const parts = [
    dueLabel(occurrence),
    'recurring ' + occurrence.type,
    formatMinorUnits(occurrence.amountMinor, occurrence.currency),
    occurrence.accountName ? 'from ' + occurrence.accountName : '',
    getDueTimingLabel(occurrence.occurrenceDate, asOfDate).toLowerCase() +
      ' ' +
      formatScheduledSpoken(occurrence.occurrenceDate),
  ].filter(Boolean);
  if (occurrence.blockedReason !== null) {
    parts.push('needs attention, ' + getBlockedReasonShort(occurrence.blockedReason).toLowerCase());
  }
  return parts.join(', ') + '.';
}

/** "Generate Rent for September 30" — the action label for a due row's primary button. */
export function getGenerateActionLabel(occurrence: DueRecurringOccurrence): string {
  return (
    'Generate ' + dueLabel(occurrence) + ' for ' + formatScheduledSpoken(occurrence.occurrenceDate)
  );
}

/** "Skip Rent for September 30" — the action label for a due row's skip button. */
export function getSkipActionLabel(occurrence: DueRecurringOccurrence): string {
  return (
    'Skip ' + dueLabel(occurrence) + ' for ' + formatScheduledSpoken(occurrence.occurrenceDate)
  );
}

// Confirmations and batch results ----------------------------------------

/** The body of the skip confirmation: exactly what will and will not happen. */
export function getSkipConfirmationMessage(occurrence: DueRecurringOccurrence): string {
  return (
    'No transaction will be created for ' +
    formatScheduledSpoken(occurrence.occurrenceDate) +
    '. The date is marked handled and will not be offered again.'
  );
}

/**
 * The "Generate all" confirmation. Deliberately a count, never a combined
 * monetary total: a due list can mix income and expenses and even currencies,
 * and a single summed figure would be meaningless or wrong.
 */
export function getGenerateAllConfirmation(count: number): string {
  if (count === 1) return 'Generate the 1 due transaction now?';
  return 'Generate the ' + count + ' due transactions now? Each uses its own scheduled date.';
}

/**
 * What a batch did, as a count sentence: "4 generated · 1 needs attention".
 * Nothing here sums money for the same reason the confirmation does not.
 */
export function describeGenerateDueResult(result: GenerateDueResult): string {
  const parts: string[] = [];
  const generated = result.generated.length;
  const handled = result.alreadyHandled.length;
  const blocked = result.blocked.length;
  const failed = result.failed.length;

  if (generated > 0) parts.push(generated + (generated === 1 ? ' generated' : ' generated'));
  if (handled > 0) parts.push(handled + ' already handled');
  if (blocked > 0) parts.push(blocked + (blocked === 1 ? ' needs attention' : ' need attention'));
  if (failed > 0) parts.push(failed + ' could not be generated');
  if (parts.length === 0) return 'Nothing to generate.';
  return parts.join(' · ');
}

// History and provenance --------------------------------------------------

/** The word for what happened to a date: a generated date became a transaction; a skipped one did not. */
export function getOccurrenceStatusLabel(status: RecurringOccurrenceStatus): string {
  return status === 'generated' ? 'Generated' : 'Skipped';
}

/** "Sep 1 — Generated" — one line of a template's history. */
export function getHistoryEntryLabel(item: OccurrenceHistoryItem): string {
  return formatScheduledShort(item.occurrenceDate) + ' — ' + getOccurrenceStatusLabel(item.status);
}

/** Spoken form of a history entry: "September 1, generated." */
export function getHistoryEntryAccessibilityLabel(item: OccurrenceHistoryItem): string {
  return (
    formatScheduledSpoken(item.occurrenceDate) +
    ', ' +
    getOccurrenceStatusLabel(item.status).toLowerCase() +
    '.'
  );
}

/** The headline of a generated transaction's provenance: that it came from a recurring plan. */
export function getProvenanceLabel(): string {
  return 'Created from a recurring transaction';
}

/**
 * The second line: which scheduled date this transaction stands for. A generated
 * transaction is dated its scheduled day, not the day it was recorded, and
 * saying so is what explains why it landed in an earlier month's figures.
 */
export function getProvenanceDetail(provenance: RecurringProvenance): string {
  return 'Scheduled for ' + formatScheduledLong(provenance.occurrenceDate);
}

// Errors ------------------------------------------------------------------

/**
 * Whether a generate or skip failed only because the date was already handled —
 * by this device a moment ago, or by another device whose change just synced in.
 * The screen's response is not an error banner but a quiet reload of the due
 * list, which will no longer contain the date.
 */
export function isAlreadyHandledError(error: unknown): boolean {
  return (
    error instanceof RecurringConflictError &&
    (error.code === 'occurrence_already_skipped' || error.code === 'occurrence_already_generated')
  );
}

/** The sentence shown when a handled-race is detected, before the list reloads. */
export const ALREADY_HANDLED_MESSAGE = 'This occurrence has already been handled.';

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return n + 'th';
  switch (n % 10) {
    case 1:
      return n + 'st';
    case 2:
      return n + 'nd';
    case 3:
      return n + 'rd';
    default:
      return n + 'th';
  }
}
