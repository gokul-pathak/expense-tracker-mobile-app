import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { PERIOD_MONTH_PATTERN } from '@/db/constants';
import {
  accounts,
  budgets,
  categories,
  isSyncEntityType,
  isSyncId,
  isSyncOperation,
  people,
  settings,
  syncBaselines,
  syncConflicts,
  syncOutbox,
  syncState,
  transactions,
  type SyncEntityType,
} from '@/db/schema';

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
  'budget_duplicate_period',
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
