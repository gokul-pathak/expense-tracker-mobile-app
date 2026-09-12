import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  MAX_RECURRENCE_INTERVAL,
  PERIOD_MONTH_PATTERN,
  RECURRING_FREQUENCIES,
  RECURRING_OCCURRENCE_STATUSES,
} from '@/db/constants';
import {
  accounts,
  budgets,
  categories,
  isSyncEntityType,
  isSyncId,
  isSyncOperation,
  people,
  recurringOccurrences,
  recurringTemplates,
  settings,
  syncBaselines,
  syncConflicts,
  syncOutbox,
  syncState,
  transactions,
  type SyncEntityType,
} from '@/db/schema';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';
import { isLocalDate, isScheduledDate } from '@/features/recurring/recurring-schedule';

/**
 * A read-only audit of everything sync depends on locally.
 *
 * It reports; it never repairs. Financial data that looks wrong is a question
 * for a person, not something a diagnostic should quietly rewrite — an
 * "automatic fix" for a duplicate identity or an orphaned queue entry is how a
 * transaction disappears without anyone deciding it should.
 *
 * Every issue is a code, a count and at most an entity type. No amounts, names
 * or notes, so a report is safe to read aloud, paste into an issue, or attach to
 * a diagnostic.
 *
 * This lives under `dev/` and is deliberately not reachable from any screen.
 */

export const SYNC_INTEGRITY_CODES = [
  'missing_sync_id',
  'invalid_sync_id',
  'duplicate_sync_id',
  'outbox_invalid_entity_type',
  'outbox_invalid_operation',
  'outbox_invalid_revision',
  'outbox_orphaned',
  'outbox_duplicate_identity',
  'sync_state_missing',
  'sync_state_dual_binding',
  'sync_state_invalid_cursor',
  'sync_state_cursor_without_link',
  'baseline_invalid_entity_type',
  'baseline_invalid_revision',
  'tombstoned_parent_in_use',
  'transaction_orphaned_relation',
  'conflict_invalid_resolution',
  'budget_invalid_amount',
  'budget_invalid_month',
  'budget_invalid_category',
  'budget_invalid_currency',
  'budget_duplicate_period',
  'recurring_template_invalid',
  'recurring_template_invalid_relation',
  'recurring_occurrence_invalid_identity',
  'recurring_occurrence_invalid_status',
  'recurring_occurrence_duplicate_date',
  'recurring_occurrence_unscheduled_date',
  'recurring_generated_without_transaction',
  'recurring_skipped_with_transaction',
  'recurring_transaction_invalid_link',
] as const;

export type SyncIntegrityCode = (typeof SYNC_INTEGRITY_CODES)[number];

export type SyncIntegrityIssue = {
  code: SyncIntegrityCode;
  entityType?: SyncEntityType | 'outbox' | 'baseline' | 'state' | 'conflict';
  count: number;
  /** Compact technical hint. Never a financial value. */
  detail?: string;
};

export type SyncIntegrityReport = {
  ok: boolean;
  issues: SyncIntegrityIssue[];
  counts: {
    accounts: number;
    categories: number;
    people: number;
    settings: number;
    transactions: number;
    budgets: number;
    recurringTemplates: number;
    recurringOccurrences: number;
    pendingMutations: number;
    baselines: number;
    conflicts: number;
  };
};

const SYNCABLE = [
  ['account', accounts],
  ['budget', budgets],
  ['category', categories],
  ['person', people],
  ['settings', settings],
  ['transaction', transactions],
  ['recurring_template', recurringTemplates],
  ['recurring_occurrence', recurringOccurrences],
] as const;

export function verifySyncIntegrity(): SyncIntegrityReport {
  const issues: SyncIntegrityIssue[] = [];

  checkIdentities(issues);
  checkOutbox(issues);
  checkSyncState(issues);
  checkBaselines(issues);
  checkTombstonedParents(issues);
  checkTransactionRelations(issues);
  checkBudgets(issues);
  checkRecurring(issues);

  return { ok: issues.length === 0, issues, counts: readCounts() };
}

/** Every syncable row needs one valid, unique global identity. */
function checkIdentities(issues: SyncIntegrityIssue[]) {
  for (const [entityType, table] of SYNCABLE) {
    const rows = db.select({ id: table.id, syncId: table.syncId }).from(table).all();

    const missing = rows.filter((row) => row.syncId === null).length;
    if (missing > 0) issues.push({ code: 'missing_sync_id', entityType, count: missing });

    const invalid = rows.filter((row) => row.syncId !== null && !isSyncId(row.syncId)).length;
    if (invalid > 0) issues.push({ code: 'invalid_sync_id', entityType, count: invalid });

    // The unique index should make this impossible; checking anyway is the
    // point of an audit.
    const seen = new Set<string>();
    let duplicates = 0;
    for (const row of rows) {
      if (row.syncId === null) continue;
      if (seen.has(row.syncId)) duplicates += 1;
      seen.add(row.syncId);
    }
    if (duplicates > 0) issues.push({ code: 'duplicate_sync_id', entityType, count: duplicates });
  }
}

function checkOutbox(issues: SyncIntegrityIssue[]) {
  const entries = db.select().from(syncOutbox).all();

  const invalidType = entries.filter((entry) => !isSyncEntityType(entry.entityType)).length;
  if (invalidType > 0) {
    issues.push({ code: 'outbox_invalid_entity_type', entityType: 'outbox', count: invalidType });
  }

  const invalidOperation = entries.filter((entry) => !isSyncOperation(entry.operation)).length;
  if (invalidOperation > 0) {
    issues.push({
      code: 'outbox_invalid_operation',
      entityType: 'outbox',
      count: invalidOperation,
    });
  }

  const invalidRevision = entries.filter(
    (entry) =>
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 1 ||
      (entry.baseServerRevision !== null && entry.baseServerRevision < 0),
  ).length;
  if (invalidRevision > 0) {
    issues.push({ code: 'outbox_invalid_revision', entityType: 'outbox', count: invalidRevision });
  }

  // One live operation per identity is what makes revision-guarded
  // acknowledgement meaningful.
  const identities = new Set<string>();
  let duplicateIdentities = 0;
  for (const entry of entries) {
    const key = `${entry.entityType}:${entry.entitySyncId}`;
    if (identities.has(key)) duplicateIdentities += 1;
    identities.add(key);
  }
  if (duplicateIdentities > 0) {
    issues.push({
      code: 'outbox_duplicate_identity',
      entityType: 'outbox',
      count: duplicateIdentities,
    });
  }

  // Queued work whose record no longer exists can never be uploaded. A delete
  // is exempt only in the sense that the row should still be present as a
  // tombstone; a row that is simply gone is an orphan either way.
  const known = new Map<SyncEntityType, Set<string>>();
  for (const [entityType, table] of SYNCABLE) {
    known.set(
      entityType,
      new Set(
        db
          .select({ syncId: table.syncId })
          .from(table)
          .where(isNotNull(table.syncId))
          .all()
          .map((row) => row.syncId as string),
      ),
    );
  }
  const orphaned = entries.filter(
    (entry) =>
      isSyncEntityType(entry.entityType) &&
      known.get(entry.entityType)?.has(entry.entitySyncId) !== true,
  ).length;
  if (orphaned > 0) {
    issues.push({ code: 'outbox_orphaned', entityType: 'outbox', count: orphaned });
  }
}

function checkSyncState(issues: SyncIntegrityIssue[]) {
  const state = db.select().from(syncState).where(eq(syncState.singletonId, 1)).get();
  if (state === undefined) {
    issues.push({ code: 'sync_state_missing', entityType: 'state', count: 1 });
    return;
  }

  // A database is either linked, or being linked. Both at once means a
  // reconciliation committed its binding without clearing its own marker.
  if (state.linkedUserId !== null && state.pendingLinkUserId !== null) {
    issues.push({ code: 'sync_state_dual_binding', entityType: 'state', count: 1 });
  }

  if (
    state.pullCursor !== null &&
    (!Number.isSafeInteger(state.pullCursor) || state.pullCursor < 0)
  ) {
    issues.push({ code: 'sync_state_invalid_cursor', entityType: 'state', count: 1 });
  }

  // A cursor describes a position in one account's change feed. Without a
  // binding it describes nothing, and could be misread by a future link.
  if (
    state.pullCursor !== null &&
    state.linkedUserId === null &&
    state.pendingLinkUserId === null
  ) {
    issues.push({ code: 'sync_state_cursor_without_link', entityType: 'state', count: 1 });
  }
}

function checkBaselines(issues: SyncIntegrityIssue[]) {
  const rows = db.select().from(syncBaselines).all();

  const invalidType = rows.filter((row) => !isSyncEntityType(row.entityType)).length;
  if (invalidType > 0) {
    issues.push({
      code: 'baseline_invalid_entity_type',
      entityType: 'baseline',
      count: invalidType,
    });
  }

  const invalidRevision = rows.filter(
    (row) => !Number.isSafeInteger(row.serverRevision) || row.serverRevision < 1,
  ).length;
  if (invalidRevision > 0) {
    issues.push({
      code: 'baseline_invalid_revision',
      entityType: 'baseline',
      count: invalidRevision,
    });
  }

  const resolutions = db.select({ resolution: syncConflicts.resolution }).from(syncConflicts).all();
  const invalidResolution = resolutions.filter((row) => typeof row.resolution !== 'string').length;
  if (invalidResolution > 0) {
    issues.push({
      code: 'conflict_invalid_resolution',
      entityType: 'conflict',
      count: invalidResolution,
    });
  }
}

/**
 * A tombstoned parent must not still be carrying live history.
 *
 * Tombstones hide a row from every domain query, so a live transaction pointing
 * at a deleted account would silently drop out of one screen's totals while
 * still counting in another. Retaining the parent row is deliberate; a live
 * child still referencing a deleted one is not.
 */
function checkTombstonedParents(issues: SyncIntegrityIssue[]) {
  const inUse =
    db
      .select({ total: sql<number>`count(*)` })
      .from(transactions)
      .where(
        sql`${transactions.deletedAt} IS NULL AND (
          ${transactions.categoryId} IN (SELECT id FROM categories WHERE deleted_at IS NOT NULL)
          OR ${transactions.sourceAccountId} IN (SELECT id FROM accounts WHERE deleted_at IS NOT NULL)
          OR ${transactions.destinationAccountId} IN (SELECT id FROM accounts WHERE deleted_at IS NOT NULL)
          OR ${transactions.personId} IN (SELECT id FROM people WHERE deleted_at IS NOT NULL)
        )`,
      )
      .get()?.total ?? 0;
  if (inUse > 0) {
    issues.push({ code: 'tombstoned_parent_in_use', entityType: 'transaction', count: inUse });
  }
}

/** A live transaction must point at rows that exist. */
function checkTransactionRelations(issues: SyncIntegrityIssue[]) {
  const orphaned =
    db
      .select({ total: sql<number>`count(*)` })
      .from(transactions)
      .where(
        sql`${transactions.deletedAt} IS NULL AND (
          (${transactions.categoryId} IS NOT NULL AND ${transactions.categoryId} NOT IN (SELECT id FROM categories))
          OR (${transactions.sourceAccountId} IS NOT NULL AND ${transactions.sourceAccountId} NOT IN (SELECT id FROM accounts))
          OR (${transactions.destinationAccountId} IS NOT NULL AND ${transactions.destinationAccountId} NOT IN (SELECT id FROM accounts))
          OR (${transactions.personId} IS NOT NULL AND ${transactions.personId} NOT IN (SELECT id FROM people))
          OR (${transactions.recurringOccurrenceId} IS NOT NULL AND ${transactions.recurringOccurrenceId} NOT IN (SELECT id FROM recurring_occurrences))
        )`,
      )
      .get()?.total ?? 0;
  if (orphaned > 0) {
    issues.push({
      code: 'transaction_orphaned_relation',
      entityType: 'transaction',
      count: orphaned,
    });
  }
}

/**
 * Budgets, checked against the rules that make one readable.
 *
 * All four are things the schema and the service already prevent, which is
 * exactly why an audit looks for them: a budget with no valid month, or two
 * budgets for the same month, would produce a figure nobody chose. Like every
 * other check here this reports and never repairs — which of two duplicate plans
 * is the real one is a question for a person.
 */
function checkBudgets(issues: SyncIntegrityIssue[]) {
  const rows = db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      periodMonth: budgets.periodMonth,
      amountMinor: budgets.amountMinor,
      currency: budgets.currency,
    })
    .from(budgets)
    .where(isNull(budgets.deletedAt))
    .all();

  const invalidAmount = rows.filter(
    (row) => !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0,
  ).length;
  if (invalidAmount > 0) {
    issues.push({ code: 'budget_invalid_amount', entityType: 'budget', count: invalidAmount });
  }

  const invalidMonth = rows.filter((row) => !PERIOD_MONTH_PATTERN.test(row.periodMonth)).length;
  if (invalidMonth > 0) {
    issues.push({ code: 'budget_invalid_month', entityType: 'budget', count: invalidMonth });
  }

  // A category budget must point at a live expense category. The overall
  // budget's null category is not a missing reference.
  const expenseCategoryIds = new Set(
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.type, 'expense')))
      .all()
      .map((row) => row.id),
  );
  const invalidCategory = rows.filter(
    (row) => row.categoryId !== null && !expenseCategoryIds.has(row.categoryId),
  ).length;
  if (invalidCategory > 0) {
    issues.push({ code: 'budget_invalid_category', entityType: 'budget', count: invalidCategory });
  }

  // What `normalizeCurrency` would have produced. A budget whose currency is
  // not canonical matches no expense, so it reads as permanently unused rather
  // than as wrong.
  const invalidCurrency = rows.filter(
    (row) => row.currency.length === 0 || row.currency !== row.currency.trim().toUpperCase(),
  ).length;
  if (invalidCurrency > 0) {
    issues.push({ code: 'budget_invalid_currency', entityType: 'budget', count: invalidCurrency });
  }

  const identities = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const identity = `${row.periodMonth}|${row.currency}|${row.categoryId ?? 'overall'}`;
    if (identities.has(identity)) duplicates += 1;
    identities.add(identity);
  }
  if (duplicates > 0) {
    issues.push({ code: 'budget_duplicate_period', entityType: 'budget', count: duplicates });
  }
}

/**
 * Recurring data, checked against the rules that make a schedule mean something
 * and the identities that make two devices agree about it.
 *
 * The identity checks matter most. An occurrence whose identity is not the one
 * derived from its template and date, or a generated transaction whose identity
 * is not derived from its occurrence, is exactly the record a second device
 * would not converge with — the rent recorded twice. Like everything here, these
 * report and never repair.
 */
function checkRecurring(issues: SyncIntegrityIssue[]) {
  const templates = db.select().from(recurringTemplates).all();
  const invalidTemplates = templates.filter(
    (template) =>
      template.deletedAt === null &&
      (!Number.isSafeInteger(template.amountMinor) ||
        template.amountMinor <= 0 ||
        !isLocalDate(template.startDate) ||
        (template.endDate !== null &&
          (!isLocalDate(template.endDate) || template.endDate < template.startDate)) ||
        !Number.isSafeInteger(template.interval) ||
        template.interval < 1 ||
        template.interval > MAX_RECURRENCE_INTERVAL ||
        !(RECURRING_FREQUENCIES as readonly string[]).includes(template.frequency)),
  ).length;
  if (invalidTemplates > 0) {
    issues.push({
      code: 'recurring_template_invalid',
      entityType: 'recurring_template',
      count: invalidTemplates,
    });
  }

  // A live template has to point at rows that still exist, and at a category of
  // its own type. An *archived* account is not a fault: the template stays and
  // its due dates are reported as blocked, which is a state the app creates on
  // purpose. Neither is a soft-deleted category, for the same reason.
  const accountIds = new Set(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .all()
      .map((r) => r.id),
  );
  const categoryTypeById = new Map(
    db
      .select({ id: categories.id, type: categories.type })
      .from(categories)
      .all()
      .map((row) => [row.id, row.type]),
  );
  const invalidRelations = templates.filter((template) => {
    if (template.deletedAt !== null) return false;
    if (!accountIds.has(template.accountId)) return true;
    const categoryType = categoryTypeById.get(template.categoryId);
    return categoryType === undefined || categoryType !== template.type;
  }).length;
  if (invalidRelations > 0) {
    issues.push({
      code: 'recurring_template_invalid_relation',
      entityType: 'recurring_template',
      count: invalidRelations,
    });
  }

  const templateSyncIds = new Map(templates.map((template) => [template.id, template.syncId]));
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const occurrences = db.select().from(recurringOccurrences).all();

  const invalidStatus = occurrences.filter(
    (occurrence) =>
      !(RECURRING_OCCURRENCE_STATUSES as readonly string[]).includes(occurrence.status),
  ).length;
  if (invalidStatus > 0) {
    issues.push({
      code: 'recurring_occurrence_invalid_status',
      entityType: 'recurring_occurrence',
      count: invalidStatus,
    });
  }

  // `(template_id, occurrence_date)` is unique outright in SQLite, tombstones
  // included, so this can only fire on a database whose index never arrived —
  // which is exactly when two decisions about one date become possible.
  const dateKeys = new Set<string>();
  let duplicateDates = 0;
  for (const occurrence of occurrences) {
    const key = `${occurrence.templateId}|${occurrence.occurrenceDate}`;
    if (dateKeys.has(key)) duplicateDates += 1;
    dateKeys.add(key);
  }
  if (duplicateDates > 0) {
    issues.push({
      code: 'recurring_occurrence_duplicate_date',
      entityType: 'recurring_occurrence',
      count: duplicateDates,
    });
  }

  // A decision about a date the template never lands on. The schedule is locked
  // once anything is handled, so a live occurrence off the schedule means the
  // template or the occurrence was rewritten outside the app.
  const unscheduled = occurrences.filter((occurrence) => {
    if (occurrence.deletedAt !== null) return false;
    const template = templateById.get(occurrence.templateId);
    if (template === undefined || !isLocalDate(occurrence.occurrenceDate)) return false;
    return !isScheduledDate(
      {
        startDate: template.startDate,
        frequency: template.frequency,
        interval: template.interval,
        endDate: template.endDate,
      },
      occurrence.occurrenceDate,
    );
  }).length;
  if (unscheduled > 0) {
    issues.push({
      code: 'recurring_occurrence_unscheduled_date',
      entityType: 'recurring_occurrence',
      count: unscheduled,
    });
  }
  const badIdentity = occurrences.filter((occurrence) => {
    const templateSyncId = templateSyncIds.get(occurrence.templateId);
    if (!isSyncId(templateSyncId) || !isLocalDate(occurrence.occurrenceDate)) return true;
    return occurrence.syncId !== deriveOccurrenceSyncId(templateSyncId, occurrence.occurrenceDate);
  }).length;
  if (badIdentity > 0) {
    issues.push({
      code: 'recurring_occurrence_invalid_identity',
      entityType: 'recurring_occurrence',
      count: badIdentity,
    });
  }

  const occurrenceSyncIds = new Map(
    occurrences.map((occurrence) => [occurrence.id, occurrence.syncId]),
  );
  const linked = db
    .select({
      syncId: transactions.syncId,
      type: transactions.type,
      deletedAt: transactions.deletedAt,
      recurringOccurrenceId: transactions.recurringOccurrenceId,
    })
    .from(transactions)
    .where(isNotNull(transactions.recurringOccurrenceId))
    .all();

  const linkedByOccurrence = new Map<number, typeof linked>();
  for (const row of linked) {
    const list = linkedByOccurrence.get(row.recurringOccurrenceId!);
    if (list === undefined) linkedByOccurrence.set(row.recurringOccurrenceId!, [row]);
    else list.push(row);
  }

  // Partial generation: the occurrence says money was recorded and no record of
  // it was ever written. Generation is one SQLite transaction precisely so this
  // cannot happen, which is what makes it worth checking — it would mean the
  // atomicity guarantee failed.
  //
  // A transaction the user *deleted* is not this. The row still exists,
  // tombstoned, and that is what proves generation completed; M8C keeps the
  // occurrence handled and never regenerates it. So existence is the test, not
  // liveness.
  const generatedWithoutTransaction = occurrences.filter(
    (occurrence) =>
      occurrence.deletedAt === null &&
      occurrence.status === 'generated' &&
      (linkedByOccurrence.get(occurrence.id) ?? []).length === 0,
  ).length;
  if (generatedWithoutTransaction > 0) {
    issues.push({
      code: 'recurring_generated_without_transaction',
      entityType: 'recurring_occurrence',
      count: generatedWithoutTransaction,
    });
  }

  // The mirror image: a date deliberately not taken that nonetheless moved money.
  const skippedWithTransaction = occurrences.filter(
    (occurrence) =>
      occurrence.deletedAt === null &&
      occurrence.status === 'skipped' &&
      (linkedByOccurrence.get(occurrence.id) ?? []).some((row) => row.deletedAt === null),
  ).length;
  if (skippedWithTransaction > 0) {
    issues.push({
      code: 'recurring_skipped_with_transaction',
      entityType: 'recurring_occurrence',
      count: skippedWithTransaction,
    });
  }
  const badLinks = linked.filter((row) => {
    const occurrenceSyncId = occurrenceSyncIds.get(row.recurringOccurrenceId!);
    if (!isSyncId(occurrenceSyncId)) return true;
    if (row.type !== 'expense' && row.type !== 'income') return true;
    return row.syncId !== deriveGeneratedTransactionSyncId(occurrenceSyncId);
  }).length;
  if (badLinks > 0) {
    issues.push({
      code: 'recurring_transaction_invalid_link',
      entityType: 'transaction',
      count: badLinks,
    });
  }
}

function readCounts(): SyncIntegrityReport['counts'] {
  const count = (table: (typeof SYNCABLE)[number][1]) =>
    db
      .select({ total: sql<number>`count(*)` })
      .from(table)
      .where(isNull(table.deletedAt))
      .get()?.total ?? 0;

  return {
    accounts: count(accounts),
    categories: count(categories),
    people: count(people),
    settings: count(settings),
    transactions: count(transactions),
    budgets: count(budgets),
    recurringTemplates: count(recurringTemplates),
    recurringOccurrences: count(recurringOccurrences),
    pendingMutations:
      db
        .select({ total: sql<number>`count(*)` })
        .from(syncOutbox)
        .get()?.total ?? 0,
    baselines:
      db
        .select({ total: sql<number>`count(*)` })
        .from(syncBaselines)
        .get()?.total ?? 0,
    conflicts:
      db
        .select({ total: sql<number>`count(*)` })
        .from(syncConflicts)
        .get()?.total ?? 0,
  };
}

/** One-line summary for a diagnostic log. Codes and counts only. */
export function summarizeSyncIntegrity(report: SyncIntegrityReport): string {
  if (report.ok) return 'sync integrity: ok';
  return `sync integrity: ${report.issues
    .map((issue) => `${issue.code}(${issue.entityType ?? 'local'})=${issue.count}`)
    .join(', ')}`;
}
