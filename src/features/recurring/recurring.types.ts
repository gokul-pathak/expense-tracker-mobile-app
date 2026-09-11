import type {
  PaymentMode,
  RecurringFrequency,
  RecurringOccurrenceStatus,
  RecurringTransactionType,
} from '@/db/constants';
import type {
  NewRecurringTemplate,
  RecurringOccurrence,
  RecurringTemplate,
} from '@/db/schema/recurring';

import type { LocalDate } from './recurring-schedule';

export type { RecurringOccurrence, RecurringTemplate };

export type CreateRecurringTemplateInput = {
  type: RecurringTransactionType;
  amountMinor: number;
  categoryId: number;
  /** The source account of an expense, the destination account of an income. */
  accountId: number;
  /** The first occurrence. */
  startDate: LocalDate;
  frequency: RecurringFrequency;
  /** "Every N" units of `frequency`. Defaults to 1. */
  interval?: number;
  /** Inclusive. Null or omitted repeats until paused or deleted. */
  endDate?: LocalDate | null;
  title?: string | null;
  note?: string | null;
  paymentMode?: PaymentMode | null;
};

/**
 * Everything but the type may be edited. An expense template does not become an
 * income template: that would change what every future generation means, and it
 * is a new template, not an edit.
 *
 * Edits affect future generation only. A transaction already generated is a
 * record of what happened, and nothing here reaches back into it.
 */
export type UpdateRecurringTemplateInput = Partial<Omit<CreateRecurringTemplateInput, 'type'>>;

export type CreateRecurringTemplateRecord = Omit<
  NewRecurringTemplate,
  'id' | 'syncId' | 'deletedAt'
>;

export type UpdateRecurringTemplateRecord = Partial<
  Pick<
    NewRecurringTemplate,
    | 'amountMinor'
    | 'currency'
    | 'categoryId'
    | 'accountId'
    | 'paymentMode'
    | 'title'
    | 'note'
    | 'startDate'
    | 'frequency'
    | 'interval'
    | 'endDate'
    | 'isPaused'
  >
> &
  Pick<NewRecurringTemplate, 'updatedAt'>;

/**
 * Why a due occurrence cannot be generated as it stands.
 *
 * These are reported, never acted on. A blocked occurrence stays due — it is not
 * skipped, and nothing is generated against a different account — because the
 * right fix is a person's decision: unarchive the account, point the template
 * somewhere else, or skip the date.
 *
 * Categories in this app are deleted rather than archived, so a category that is
 * no longer available is `category_deleted`.
 */
export const RECURRING_BLOCKED_REASONS = [
  'account_archived',
  'account_deleted',
  'category_deleted',
  'category_type_mismatch',
  'currency_mismatch',
] as const;

export type RecurringBlockedReason = (typeof RECURRING_BLOCKED_REASONS)[number];

/**
 * One scheduled date that is due and not yet handled.
 *
 * Derived, never stored: it is the template's schedule minus its handled
 * occurrences, computed whenever it is asked for. Nothing here has a row until
 * someone generates or skips it.
 */
export type DueRecurringOccurrence = {
  templateId: number;
  templateSyncId: string;
  occurrenceDate: LocalDate;
  type: RecurringTransactionType;
  amountMinor: number;
  currency: string;
  categoryId: number;
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: number;
  accountName: string | null;
  title: string;
  /** Null when this date can be generated as the template stands. */
  blockedReason: RecurringBlockedReason | null;
};

export type DueOccurrencesResult = {
  /** Oldest first, across every template. */
  occurrences: DueRecurringOccurrence[];
  /** True when more due dates exist than were returned. They are never dropped. */
  hasMore: boolean;
};

/** A template as a list would show it. `nextDueDate` is derived, never stored. */
export type RecurringTemplateView = RecurringTemplate & {
  categoryName: string | null;
  categoryIcon: string | null;
  accountName: string | null;
  /**
   * The earliest scheduled date not yet generated or skipped, whether or not it
   * has arrived. Null once the schedule has ended and every date is handled.
   */
  nextDueDate: LocalDate | null;
  handledCount: number;
};

export type GenerateOccurrenceResult = {
  outcome: 'generated' | 'already_generated';
  occurrence: RecurringOccurrence;
  /**
   * The generated transaction. Null only for an occurrence generated earlier
   * whose transaction has since been deleted: the date stays handled, and is
   * never quietly generated again.
   */
  transactionId: number | null;
};

export type SkipOccurrenceResult = {
  outcome: 'skipped' | 'already_skipped';
  occurrence: RecurringOccurrence;
};

/**
 * The compact recurring read a Home screen consumes: how many dates are due and
 * a few of them to preview. Bounded — Home never enumerates years of overdue
 * dates, and a combined total is deliberately absent, since due dates mix income
 * and expenses.
 */
export type RecurringHomeSummary = {
  dueCount: number;
  hasMore: boolean;
  preview: DueRecurringOccurrence[];
};

/** One handled date, for a template detail screen's short history. */
export type OccurrenceHistoryItem = {
  occurrenceDate: LocalDate;
  status: RecurringOccurrenceStatus;
  /** The live transaction a generated date produced, or null for a skip or a deleted one. */
  transactionId: number | null;
};

/** Where a generated transaction came from, for its provenance line. */
export type RecurringProvenance = {
  occurrenceDate: LocalDate;
  type: RecurringTransactionType;
  /** The template's title, its category, or its type — never blank. */
  label: string;
  /** True when the template it came from has since been deleted. */
  templateDeleted: boolean;
};

/** How many of a template's dates are outstanding as of a day, bounded. */
export type OutstandingCount = { count: number; hasMore: boolean };

type BatchItem = { templateId: number; occurrenceDate: LocalDate };

/**
 * One batch, reported item by item.
 *
 * Every occurrence is its own atomic write, so one archived account blocks its
 * own dates and nothing else — a batch is never all-or-nothing.
 */
export type GenerateDueResult = {
  generated: (BatchItem & { transactionId: number })[];
  alreadyHandled: (BatchItem & { status: RecurringOccurrenceStatus })[];
  blocked: (BatchItem & { reason: RecurringBlockedReason })[];
  failed: (BatchItem & { reason: string })[];
  hasMore: boolean;
};
