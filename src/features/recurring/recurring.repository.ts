import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import type { RecurringOccurrenceStatus } from '@/db/constants';
import {
  accounts,
  categories,
  recurringOccurrences,
  recurringTemplates,
  transactions,
} from '@/db/schema';
import type { RecurringOccurrence, RecurringTemplate } from '@/db/schema/recurring';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import type { SyncWriter } from '@/features/sync/sync.types';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';
import * as transactionRepository from '@/features/transactions/transaction.repository';
import type { CreateTransactionRecord } from '@/features/transactions/transaction.types';

import type { LocalDate } from './recurring-schedule';
import { RecurringConflictError } from './recurring.errors';
import type {
  CreateRecurringTemplateRecord,
  UpdateRecurringTemplateRecord,
} from './recurring.types';

/**
 * Recurring reads and writes.
 *
 * Nothing here reads the transactions table to decide what is due. What is due
 * is the schedule minus the occurrences table, so the cost of asking grows with
 * a person's templates and decisions, never with years of spending.
 */

const liveTemplate = isNull(recurringTemplates.deletedAt);
const liveOccurrence = isNull(recurringOccurrences.deletedAt);

/**
 * A template with the state of what it points at.
 *
 * Joined without a tombstone filter on purpose: a template whose account was
 * archived or whose category was deleted is still a template, and the reason it
 * can no longer generate is exactly what the caller needs to report.
 */
export type TemplateRow = {
  template: RecurringTemplate;
  categoryName: string | null;
  categoryType: string | null;
  categoryDeletedAt: Date | null;
  accountName: string | null;
  accountCurrency: string | null;
  accountArchived: boolean | null;
  accountDeletedAt: Date | null;
};

function templateQuery() {
  return db
    .select({
      template: recurringTemplates,
      categoryName: categories.name,
      categoryType: categories.type,
      categoryDeletedAt: categories.deletedAt,
      accountName: accounts.name,
      accountCurrency: accounts.currency,
      accountArchived: accounts.isArchived,
      accountDeletedAt: accounts.deletedAt,
    })
    .from(recurringTemplates)
    .leftJoin(categories, eq(recurringTemplates.categoryId, categories.id))
    .leftJoin(accounts, eq(recurringTemplates.accountId, accounts.id));
}

/** Live templates, optionally only those that are not paused, optionally just one. */
export function getTemplateRows(
  options: { activeOnly?: boolean; templateId?: number } = {},
): TemplateRow[] {
  return templateQuery()
    .where(
      and(
        liveTemplate,
        options.activeOnly === true ? eq(recurringTemplates.isPaused, false) : undefined,
        options.templateId === undefined
          ? undefined
          : eq(recurringTemplates.id, options.templateId),
      ),
    )
    .orderBy(asc(recurringTemplates.id))
    .all();
}

export function getTemplateRowById(id: number): TemplateRow | null {
  return getTemplateRows({ templateId: id })[0] ?? null;
}

export function getTemplateById(id: number): RecurringTemplate | null {
  return (
    db
      .select()
      .from(recurringTemplates)
      .where(and(liveTemplate, eq(recurringTemplates.id, id)))
      .get() ?? null
  );
}

export function createTemplate(data: CreateRecurringTemplateRecord): RecurringTemplate {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const template = tx
      .insert(recurringTemplates)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'recurring_template',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return template;
  });
}

export function updateTemplate(
  id: number,
  data: UpdateRecurringTemplateRecord,
): RecurringTemplate | null {
  return db.transaction((tx) => {
    const template =
      tx
        .update(recurringTemplates)
        .set(data)
        .where(and(liveTemplate, eq(recurringTemplates.id, id)))
        .returning()
        .get() ?? null;
    if (template === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'recurring_template',
      entitySyncId: requireSyncId(template.syncId, 'recurring template'),
      operation: 'upsert',
    });
    return template;
  });
}

/**
 * Deletion is a tombstone, and it stops the schedule and nothing else.
 *
 * The occurrences and the transactions they produced are left exactly as they
 * are: those transactions are a record of money that moved, and a person
 * deciding to stop a repeating payment has not decided that the payments they
 * already made never happened.
 */
export function deleteTemplate(id: number, deletedAt = new Date()): RecurringTemplate | null {
  return db.transaction((tx) => {
    const template =
      tx
        .update(recurringTemplates)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(liveTemplate, eq(recurringTemplates.id, id)))
        .returning()
        .get() ?? null;
    if (template === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'recurring_template',
      entitySyncId: requireSyncId(template.syncId, 'recurring template'),
      operation: 'delete',
    });
    return template;
  });
}

/**
 * The handled dates of several templates, in one query.
 *
 * A retired occurrence — one a cloud replacement tombstoned — is not handled:
 * the dataset it belonged to was replaced, and its date is outstanding again.
 */
export function getHandledDates(
  templateIds: readonly number[],
): Map<number, Map<LocalDate, RecurringOccurrenceStatus>> {
  const handled = new Map<number, Map<LocalDate, RecurringOccurrenceStatus>>();
  const unique = [...new Set(templateIds)];
  if (unique.length === 0) return handled;

  const rows = db
    .select({
      templateId: recurringOccurrences.templateId,
      occurrenceDate: recurringOccurrences.occurrenceDate,
      status: recurringOccurrences.status,
    })
    .from(recurringOccurrences)
    .where(and(liveOccurrence, inArray(recurringOccurrences.templateId, unique)))
    .all();
  for (const row of rows) {
    const dates = handled.get(row.templateId) ?? new Map<LocalDate, RecurringOccurrenceStatus>();
    dates.set(row.occurrenceDate, row.status);
    handled.set(row.templateId, dates);
  }
  return handled;
}

export function countHandledOccurrences(templateId: number): number {
  return (
    db
      .select({ total: sql<number>`count(*)` })
      .from(recurringOccurrences)
      .where(and(liveOccurrence, eq(recurringOccurrences.templateId, templateId)))
      .get()?.total ?? 0
  );
}

export function getLatestHandledDate(templateId: number): LocalDate | null {
  return (
    db
      .select({ latest: sql<string | null>`max(${recurringOccurrences.occurrenceDate})` })
      .from(recurringOccurrences)
      .where(and(liveOccurrence, eq(recurringOccurrences.templateId, templateId)))
      .get()?.latest ?? null
  );
}

/** The one row for a template and date, live or retired. There is never more than one. */
export function findOccurrence(templateId: number, occurrenceDate: LocalDate) {
  return (
    db
      .select()
      .from(recurringOccurrences)
      .where(
        and(
          eq(recurringOccurrences.templateId, templateId),
          eq(recurringOccurrences.occurrenceDate, occurrenceDate),
        ),
      )
      .get() ?? null
  );
}

/** The live transaction an occurrence produced, if it has not been deleted since. */
export function getGeneratedTransactionId(
  occurrenceId: number,
  writer: SyncWriter = db,
): number | null {
  return (
    writer
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(isNull(transactions.deletedAt), eq(transactions.recurringOccurrenceId, occurrenceId)),
      )
      .get()?.id ?? null
  );
}

type OccurrenceWrite = {
  templateId: number;
  occurrenceDate: LocalDate;
  occurrenceSyncId: string;
  now: Date;
};

/**
 * Records a generated occurrence and its transaction, atomically.
 *
 * One SQLite transaction holds all four writes — the occurrence, its queue
 * entry, the transaction, and its queue entry — so either all of them commit or
 * none do. There is no state in which a date is marked generated without the
 * transaction it produced, or a generated transaction exists that no occurrence
 * accounts for; either half-state would let the date be generated twice.
 *
 * The occurrence is checked again inside the transaction. The service checked
 * it a moment ago, but this is the check that commits.
 */
export function writeGeneratedOccurrence(
  input: OccurrenceWrite & { transactionSyncId: string; transaction: CreateTransactionRecord },
): { occurrence: RecurringOccurrence; transactionId: number | null; created: boolean } {
  return db.transaction((tx) => {
    const existing = readOccurrenceBySyncId(tx, input.occurrenceSyncId);
    assertSameOccurrence(existing, input);

    if (existing !== null && existing.deletedAt === null) {
      if (existing.status === 'skipped') throw alreadySkipped();
      return {
        occurrence: existing,
        transactionId: getGeneratedTransactionId(existing.id, tx),
        created: false,
      };
    }

    const occurrence =
      existing === null
        ? tx
            .insert(recurringOccurrences)
            .values({
              templateId: input.templateId,
              occurrenceDate: input.occurrenceDate,
              status: 'generated',
              createdAt: input.now,
              updatedAt: input.now,
              syncId: input.occurrenceSyncId,
            })
            .returning()
            .get()
        : revive(tx, existing.id, 'generated', input.now);
    enqueueSyncMutation(tx, {
      entityType: 'recurring_occurrence',
      entitySyncId: input.occurrenceSyncId,
      operation: 'upsert',
    });

    const { transaction } = transactionRepository.writeGeneratedTransaction(
      tx,
      { ...input.transaction, recurringOccurrenceId: occurrence.id },
      input.transactionSyncId,
    );
    return { occurrence, transactionId: transaction.id, created: true };
  });
}

/**
 * Records a skipped occurrence, atomically with its queue entry.
 *
 * Skipping writes one planning row and nothing else: no transaction, no balance,
 * no report and no budget moves.
 */
export function writeSkippedOccurrence(input: OccurrenceWrite): {
  occurrence: RecurringOccurrence;
  created: boolean;
} {
  return db.transaction((tx) => {
    const existing = readOccurrenceBySyncId(tx, input.occurrenceSyncId);
    assertSameOccurrence(existing, input);

    if (existing !== null && existing.deletedAt === null) {
      if (existing.status === 'generated') {
        throw new RecurringConflictError(
          'occurrence_already_generated',
          'This date already produced a transaction. Edit or delete that transaction instead.',
        );
      }
      return { occurrence: existing, created: false };
    }

    const occurrence =
      existing === null
        ? tx
            .insert(recurringOccurrences)
            .values({
              templateId: input.templateId,
              occurrenceDate: input.occurrenceDate,
              status: 'skipped',
              createdAt: input.now,
              updatedAt: input.now,
              syncId: input.occurrenceSyncId,
            })
            .returning()
            .get()
        : revive(tx, existing.id, 'skipped', input.now);
    enqueueSyncMutation(tx, {
      entityType: 'recurring_occurrence',
      entitySyncId: input.occurrenceSyncId,
      operation: 'upsert',
    });
    return { occurrence, created: true };
  });
}

function readOccurrenceBySyncId(writer: SyncWriter, syncId: string) {
  return (
    writer
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.syncId, syncId))
      .get() ?? null
  );
}

/** A retired occurrence returns under the identity it always had. */
function revive(
  writer: SyncWriter,
  id: number,
  status: RecurringOccurrenceStatus,
  now: Date,
): RecurringOccurrence {
  const row = writer
    .update(recurringOccurrences)
    .set({ status, updatedAt: now, deletedAt: null })
    .where(eq(recurringOccurrences.id, id))
    .returning()
    .get();
  if (row === undefined) throw new Error('A retired recurring occurrence could not be revived.');
  return row;
}

/**
 * The identity is derived from the template and the date, so a row found under
 * it must be for that template and date. Anything else is a corrupted identity,
 * and writing through it would attach a transaction to the wrong schedule.
 */
function assertSameOccurrence(existing: RecurringOccurrence | null, input: OccurrenceWrite) {
  if (existing === null) return;
  if (
    existing.templateId !== input.templateId ||
    existing.occurrenceDate !== input.occurrenceDate
  ) {
    throw new Error('A recurring occurrence identity belongs to a different template or date.');
  }
}

function alreadySkipped() {
  return new RecurringConflictError(
    'occurrence_already_skipped',
    'This date was skipped, so it will not be generated.',
  );
}
