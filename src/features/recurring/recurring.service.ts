import { getAccountById } from '@/features/accounts/account.repository';
import { getCategoryById } from '@/features/categories/category.repository';
import { NotFoundError, ValidationError } from '@/features/shared/errors';
import { requireSyncId } from '@/features/sync/uuid';
import * as transactionService from '@/features/transactions/transaction.service';

import { deriveGeneratedTransactionSyncId, deriveOccurrenceSyncId } from './recurring-identity';
import {
  isLocalDate,
  isScheduledDate,
  iterateOccurrenceDates,
  localDateOf,
  toTransactionInstant,
  type LocalDate,
  type RecurrenceSchedule,
} from './recurring-schedule';
import { RecurringConflictError, RecurringValidationError } from './recurring.errors';
import * as repository from './recurring.repository';
import type { TemplateRow } from './recurring.repository';
import {
  RECURRING_BLOCKED_REASONS,
  type CreateRecurringTemplateInput,
  type DueOccurrencesResult,
  type DueRecurringOccurrence,
  type GenerateDueResult,
  type GenerateOccurrenceResult,
  type RecurringBlockedReason,
  type RecurringTemplate,
  type RecurringTemplateView,
  type SkipOccurrenceResult,
  type UpdateRecurringTemplateInput,
  type UpdateRecurringTemplateRecord,
} from './recurring.types';
import {
  describeBlockedReason,
  evaluateGenerationBlock,
  normalizeAmountMinor,
  normalizeEndDate,
  normalizeFrequency,
  normalizeInterval,
  normalizeLocalDate,
  normalizeNote,
  normalizePaymentMode,
  normalizeRecurringType,
  normalizeTitle,
} from './recurring.validation';

/**
 * The recurring engine.
 *
 * A template is a plan. It has no financial effect, and nothing here gives it
 * one: no balance, report, budget or receivable reads a template. Money moves
 * only when an occurrence is generated, and what it produces is an ordinary
 * expense or income, built by the transaction service under exactly the rules a
 * hand-entered one meets.
 *
 * What is due is derived, never stored: the template's schedule, minus the
 * dates already generated or skipped. Nothing is materialised in advance, and
 * nothing here runs by itself — no startup hook, no timer, no background task.
 * A caller asks what is due as of a date and decides what to do about it. M8D
 * is that caller.
 *
 * Every entry point that depends on "today" takes an `asOfDate`, so the engine
 * never consults a clock it was not given. Omitted, it is this device's local
 * calendar date.
 */

/** The most due dates any one call returns. More are reported, never dropped. */
export const DUE_OCCURRENCE_LIMIT = 100;

// Templates ---------------------------------------------------------------

export function createRecurringTemplate(input: CreateRecurringTemplateInput): RecurringTemplate {
  const type = normalizeRecurringType(input.type);
  const amountMinor = normalizeAmountMinor(input.amountMinor);
  const account = requireActiveAccount(input.accountId);
  const category = requireCategory(input.categoryId, type);
  const startDate = normalizeLocalDate(input.startDate, 'Start date');
  const frequency = normalizeFrequency(input.frequency);
  const interval = normalizeInterval(input.interval);
  const endDate = normalizeEndDate(input.endDate, startDate);

  const now = new Date();
  return repository.createTemplate({
    type,
    amountMinor,
    // The account's, exactly as a transaction takes it. Recorded so that an
    // account whose currency later changes blocks generation instead of
    // producing a transaction in a currency nobody chose.
    currency: account.currency,
    categoryId: category.id,
    accountId: account.id,
    paymentMode: normalizePaymentMode(input.paymentMode),
    title: normalizeTitle(input.title),
    note: normalizeNote(input.note),
    startDate,
    frequency,
    interval,
    endDate,
    isPaused: false,
    createdAt: now,
    updatedAt: now,
  });
}

export function getRecurringTemplate(id: number): RecurringTemplate {
  return repository.getTemplateById(id) ?? notFound(id);
}

/**
 * Every live template, active first, then by the date it next needs attention,
 * then by name — the same order on every read, so a list never reshuffles itself.
 */
export function listRecurringTemplates(): RecurringTemplateView[] {
  const rows = repository.getTemplateRows();
  const handled = repository.getHandledDates(rows.map((row) => row.template.id));

  return rows
    .map((row) => {
      const dates = handled.get(row.template.id);
      return {
        ...row.template,
        categoryName: row.categoryName,
        accountName: row.accountName,
        nextDueDate: firstUnhandledDate(scheduleOf(row.template), dates),
        handledCount: dates?.size ?? 0,
      };
    })
    .sort(compareTemplateViews);
}

/**
 * Editing changes the plan for dates not yet handled. A transaction already
 * generated is a record of what happened and keeps its amount, category and
 * account whatever the template says afterwards.
 *
 * The schedule itself — start, frequency, interval — can change only while no
 * date has been handled. Once one has, moving the schedule would leave that
 * decision describing a date the template no longer has, and "which of these
 * handled dates still count" is not a question to answer by guessing.
 */
export function updateRecurringTemplate(
  id: number,
  input: UpdateRecurringTemplateInput,
): RecurringTemplate {
  const current = getRecurringTemplate(id);
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one template field to update.');
  }
  if ('type' in input) {
    throw new ValidationError('A template’s type cannot change. Create a new template instead.');
  }

  const data: Omit<UpdateRecurringTemplateRecord, 'updatedAt'> = {};
  if (input.amountMinor !== undefined) data.amountMinor = normalizeAmountMinor(input.amountMinor);
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    data.categoryId = requireCategory(input.categoryId, current.type).id;
  }
  if (input.accountId !== undefined && input.accountId !== current.accountId) {
    const account = requireActiveAccount(input.accountId);
    data.accountId = account.id;
    data.currency = account.currency;
  }
  if (input.paymentMode !== undefined) data.paymentMode = normalizePaymentMode(input.paymentMode);
  if (input.title !== undefined) data.title = normalizeTitle(input.title);
  if (input.note !== undefined) data.note = normalizeNote(input.note);

  const startDate =
    input.startDate === undefined
      ? current.startDate
      : normalizeLocalDate(input.startDate, 'Start date');
  const frequency =
    input.frequency === undefined ? current.frequency : normalizeFrequency(input.frequency);
  const interval =
    input.interval === undefined ? current.interval : normalizeInterval(input.interval);
  const scheduleChanged =
    startDate !== current.startDate ||
    frequency !== current.frequency ||
    interval !== current.interval;

  if (scheduleChanged) {
    if (repository.countHandledOccurrences(id) > 0) {
      throw new RecurringConflictError(
        'schedule_locked',
        'The schedule cannot change once a date has been generated or skipped. Delete this template and create a new one instead.',
      );
    }
    data.startDate = startDate;
    data.frequency = frequency;
    data.interval = interval;
  }

  const endDate =
    input.endDate === undefined ? current.endDate : normalizeEndDate(input.endDate, startDate);
  if (endDate !== null && endDate < startDate) {
    throw new ValidationError('End date cannot be before the start date.');
  }
  if (input.endDate !== undefined) {
    const latest = repository.getLatestHandledDate(id);
    if (endDate !== null && latest !== null && endDate < latest) {
      throw new RecurringValidationError(
        'end_before_handled',
        'The end date cannot be before a date that was already generated or skipped.',
      );
    }
    data.endDate = endDate;
  }

  if (Object.keys(data).length === 0) return current;
  return repository.updateTemplate(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

/**
 * Paused templates keep their history and produce nothing new until resumed.
 * Pausing is a change to the plan, so it syncs like any other edit.
 */
export function pauseRecurringTemplate(id: number): RecurringTemplate {
  return setPaused(id, true);
}

/**
 * Resuming does not forgive the dates that passed while paused.
 *
 * They are outstanding again the moment the template resumes, exactly as if it
 * had never been paused, and each can be generated or skipped. Discarding them
 * silently would decide on someone's behalf that a rent payment did not happen;
 * showing them lets the person decide.
 */
export function resumeRecurringTemplate(id: number): RecurringTemplate {
  return setPaused(id, false);
}

/**
 * Stops the schedule. Every transaction it already produced stays exactly as
 * it is, and so does the record of which dates were handled.
 */
export function deleteRecurringTemplate(id: number): RecurringTemplate {
  return repository.deleteTemplate(id) ?? notFound(id);
}

// The scheduler ------------------------------------------------------------

/**
 * Every date that is due as of `asOfDate` and not yet handled, oldest first,
 * across all active templates.
 *
 * Bounded: at most `limit` dates, with `hasMore` saying whether others exist.
 * Chronological across templates, so a long-missed date is never pushed out by a
 * recent one — the oldest outstanding dates are always the ones returned.
 *
 * A date whose template can no longer generate — an archived account, a deleted
 * category — is still returned, with `blockedReason` saying why. It is due; it
 * is simply not something the engine can resolve on anyone's behalf.
 */
export function listDueOccurrences(
  options: { asOfDate?: LocalDate; limit?: number; templateId?: number } = {},
): DueOccurrencesResult {
  const asOfDate = resolveAsOfDate(options.asOfDate);
  const limit = normalizeDueLimit(options.limit);
  const rows = repository.getTemplateRows({ activeOnly: true, templateId: options.templateId });
  const handled = repository.getHandledDates(rows.map((row) => row.template.id));

  const candidates: { row: TemplateRow; date: LocalDate }[] = [];
  let truncated = false;
  for (const row of rows) {
    const dates = handled.get(row.template.id);
    let taken = 0;
    for (const date of iterateOccurrenceDates(scheduleOf(row.template), { to: asOfDate })) {
      if (dates?.has(date) === true) continue;
      // No template can contribute more than the whole answer, so the walk stops
      // there rather than enumerating years of a daily schedule.
      if (taken === limit) {
        truncated = true;
        break;
      }
      candidates.push({ row, date });
      taken += 1;
    }
  }

  candidates.sort(
    (left, right) =>
      compareText(left.date, right.date) ||
      compareText(left.row.template.syncId ?? '', right.row.template.syncId ?? '') ||
      left.row.template.id - right.row.template.id,
  );

  return {
    occurrences: candidates.slice(0, limit).map(({ row, date }) => toDue(row, date)),
    hasMore: truncated || candidates.length > limit,
  };
}

/**
 * The earliest scheduled date of a template not yet generated or skipped,
 * whether it has arrived or not. Null once the schedule has ended and every one
 * of its dates is handled.
 */
export function getNextDueDate(templateId: number): LocalDate | null {
  const template = getRecurringTemplate(templateId);
  const handled = repository.getHandledDates([template.id]).get(template.id);
  return firstUnhandledDate(scheduleOf(template), handled);
}

/**
 * Generates one due date as an ordinary transaction.
 *
 * The transaction is built by the transaction service — the same validation a
 * hand-entered expense or income meets — and written with its occurrence in one
 * SQLite transaction. Its `transactionDate` is the scheduled date, not today:
 * rent due on the 30th and recorded on the 3rd belongs to the 30th's month, its
 * budget and its report. Its `createdAt` is when it was actually recorded.
 *
 * Idempotent. Generating a date that is already generated returns what exists
 * and writes nothing. Two devices doing it offline derive the same identities
 * and converge in the cloud on one occurrence and one transaction.
 */
export function generateOccurrence(
  templateId: number,
  occurrenceDate: LocalDate,
  options: { asOfDate?: LocalDate } = {},
): GenerateOccurrenceResult {
  const asOfDate = resolveAsOfDate(options.asOfDate);
  const row = repository.getTemplateRowById(templateId);
  if (row === null) notFound(templateId);
  const template = row.template;
  const date = requireDueDate(template, occurrenceDate, asOfDate);
  if (template.isPaused) throw pausedError();

  const existing = repository.findOccurrence(template.id, date);
  if (existing !== null && existing.deletedAt === null) {
    if (existing.status === 'skipped') {
      throw new RecurringConflictError(
        'occurrence_already_skipped',
        'This date was skipped, so it will not be generated.',
      );
    }
    return {
      outcome: 'already_generated',
      occurrence: existing,
      transactionId: repository.getGeneratedTransactionId(existing.id),
    };
  }

  const blocked = blockedReasonOf(row);
  if (blocked !== null) throw new RecurringValidationError(blocked, describeBlockedReason(blocked));

  const transaction = transactionService.prepareGeneratedTransaction(template.type, {
    amountMinor: template.amountMinor,
    categoryId: template.categoryId,
    accountId: template.accountId,
    transactionDate: toTransactionInstant(date),
    title: template.title,
    note: template.note,
    paymentMode: template.paymentMode,
  });

  const occurrenceSyncId = deriveOccurrenceSyncId(
    requireSyncId(template.syncId, 'recurring template'),
    date,
  );
  const written = repository.writeGeneratedOccurrence({
    templateId: template.id,
    occurrenceDate: date,
    occurrenceSyncId,
    transactionSyncId: deriveGeneratedTransactionSyncId(occurrenceSyncId),
    transaction,
    now: new Date(),
  });

  return {
    outcome: written.created ? 'generated' : 'already_generated',
    occurrence: written.occurrence,
    transactionId: written.transactionId,
  };
}

/**
 * Marks one due date as deliberately not happening.
 *
 * No transaction, no balance, no report and no budget moves. The date stops
 * being due and is never offered again. Skipping twice returns the existing
 * decision. Skipping a date that already produced a transaction is refused: the
 * transaction is the record of what happened, and removing it is a job for the
 * transaction screens, not a side effect of a skip.
 */
export function skipOccurrence(
  templateId: number,
  occurrenceDate: LocalDate,
  options: { asOfDate?: LocalDate } = {},
): SkipOccurrenceResult {
  const asOfDate = resolveAsOfDate(options.asOfDate);
  const template = getRecurringTemplate(templateId);
  const date = requireDueDate(template, occurrenceDate, asOfDate);
  if (template.isPaused) throw pausedError();

  const written = repository.writeSkippedOccurrence({
    templateId: template.id,
    occurrenceDate: date,
    occurrenceSyncId: deriveOccurrenceSyncId(
      requireSyncId(template.syncId, 'recurring template'),
      date,
    ),
    now: new Date(),
  });
  return {
    outcome: written.created ? 'skipped' : 'already_skipped',
    occurrence: written.occurrence,
  };
}

/**
 * Generates every due date it can, oldest first, one at a time.
 *
 * Each occurrence is its own atomic write. A batch wrapped in one transaction
 * would let one archived account roll back every other template's rent; here a
 * blocked date is reported as blocked and everything else still happens. Safe to
 * repeat: an occurrence already handled is reported, not generated again.
 */
export function generateDueOccurrences(
  options: { asOfDate?: LocalDate; limit?: number } = {},
): GenerateDueResult {
  const asOfDate = resolveAsOfDate(options.asOfDate);
  const due = listDueOccurrences({ asOfDate, limit: options.limit });
  const result: GenerateDueResult = {
    generated: [],
    alreadyHandled: [],
    blocked: [],
    failed: [],
    hasMore: due.hasMore,
  };

  for (const item of due.occurrences) {
    const key = { templateId: item.templateId, occurrenceDate: item.occurrenceDate };
    if (item.blockedReason !== null) {
      result.blocked.push({ ...key, reason: item.blockedReason });
      continue;
    }
    try {
      const generated = generateOccurrence(item.templateId, item.occurrenceDate, { asOfDate });
      if (generated.outcome === 'generated' && generated.transactionId !== null) {
        result.generated.push({ ...key, transactionId: generated.transactionId });
      } else {
        result.alreadyHandled.push({ ...key, status: 'generated' });
      }
    } catch (error) {
      if (error instanceof RecurringConflictError && error.code === 'occurrence_already_skipped') {
        result.alreadyHandled.push({ ...key, status: 'skipped' });
      } else if (error instanceof RecurringValidationError && isBlockedReason(error.code)) {
        result.blocked.push({ ...key, reason: error.code });
      } else {
        // A classification only, never a value from the record.
        result.failed.push({ ...key, reason: error instanceof Error ? error.name : 'unknown' });
      }
    }
  }
  return result;
}

// Internals ---------------------------------------------------------------

function setPaused(id: number, isPaused: boolean): RecurringTemplate {
  const current = getRecurringTemplate(id);
  if (current.isPaused === isPaused) return current;
  return repository.updateTemplate(id, { isPaused, updatedAt: new Date() }) ?? notFound(id);
}

function scheduleOf(template: RecurringTemplate): RecurrenceSchedule {
  return {
    startDate: template.startDate,
    frequency: template.frequency,
    interval: template.interval,
    endDate: template.endDate,
  };
}

/**
 * Walks the schedule until it finds a date nobody has handled. The walk is as
 * long as the run of handled dates before it, plus one.
 */
function firstUnhandledDate(
  schedule: RecurrenceSchedule,
  handled: Map<LocalDate, unknown> | undefined,
): LocalDate | null {
  for (const date of iterateOccurrenceDates(schedule)) {
    if (handled?.has(date) !== true) return date;
  }
  return null;
}

/** A real date, one the schedule lands on, and one that has arrived. */
function requireDueDate(
  template: RecurringTemplate,
  value: unknown,
  asOfDate: LocalDate,
): LocalDate {
  if (!isLocalDate(value)) {
    throw new RecurringValidationError(
      'invalid_date',
      'Occurrence date must be a calendar date written YYYY-MM-DD.',
    );
  }
  if (!isScheduledDate(scheduleOf(template), value)) {
    throw new RecurringValidationError(
      'not_scheduled',
      'This template is not scheduled on that date.',
    );
  }
  if (value > asOfDate) {
    throw new RecurringValidationError('future_occurrence', 'That date has not arrived yet.');
  }
  return value;
}

function blockedReasonOf(row: TemplateRow): RecurringBlockedReason | null {
  return evaluateGenerationBlock(
    row.template,
    row.accountCurrency === null
      ? null
      : {
          currency: row.accountCurrency,
          isArchived: row.accountArchived === true,
          deletedAt: row.accountDeletedAt,
        },
    row.categoryType === null ? null : { type: row.categoryType, deletedAt: row.categoryDeletedAt },
  );
}

function toDue(row: TemplateRow, date: LocalDate): DueRecurringOccurrence {
  const template = row.template;
  return {
    templateId: template.id,
    templateSyncId: requireSyncId(template.syncId, 'recurring template'),
    occurrenceDate: date,
    type: template.type,
    amountMinor: template.amountMinor,
    currency: template.currency,
    categoryId: template.categoryId,
    categoryName: row.categoryName,
    accountId: template.accountId,
    accountName: row.accountName,
    title: template.title,
    blockedReason: blockedReasonOf(row),
  };
}

function requireActiveAccount(id: number) {
  const account = getAccountById(id);
  if (account === null) throw new NotFoundError(`Account ${id} was not found.`);
  if (account.isArchived) throw new ValidationError('Choose an active account.');
  return account;
}

function requireCategory(id: number, type: RecurringTemplate['type']) {
  const category = getCategoryById(id);
  if (category === null) throw new NotFoundError(`Category ${id} was not found.`);
  if (category.type !== type) {
    throw new ValidationError(`A repeating ${type} needs an ${type} category.`);
  }
  return category;
}

function resolveAsOfDate(value: LocalDate | undefined): LocalDate {
  if (value === undefined) return localDateOf(new Date());
  return normalizeLocalDate(value, 'As-of date');
}

function normalizeDueLimit(value: number | undefined): number {
  const limit = value ?? DUE_OCCURRENCE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DUE_OCCURRENCE_LIMIT) {
    throw new ValidationError(`Ask for between 1 and ${DUE_OCCURRENCE_LIMIT} due dates.`);
  }
  return limit;
}

function compareTemplateViews(left: RecurringTemplateView, right: RecurringTemplateView): number {
  if (left.isPaused !== right.isPaused) return left.isPaused ? 1 : -1;
  if (left.nextDueDate !== right.nextDueDate) {
    if (left.nextDueDate === null) return 1;
    if (right.nextDueDate === null) return -1;
    return compareText(left.nextDueDate, right.nextDueDate);
  }
  const byName = labelOf(left).localeCompare(labelOf(right));
  return byName !== 0 ? byName : left.id - right.id;
}

function labelOf(view: RecurringTemplateView): string {
  return view.title || view.categoryName || '';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isBlockedReason(code: string): code is RecurringBlockedReason {
  return (RECURRING_BLOCKED_REASONS as readonly string[]).includes(code);
}

function pausedError() {
  return new RecurringConflictError(
    'template_paused',
    'This template is paused. Resume it to generate or skip its dates.',
  );
}

function notFound(id: number): never {
  throw new NotFoundError(`Recurring template ${id} was not found.`);
}
