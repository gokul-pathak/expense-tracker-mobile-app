import Constants from 'expo-constants';
import { asc, isNull, like } from 'drizzle-orm';

import { db } from '@/db';
import {
  appMetadata,
  accounts,
  budgets,
  categories,
  people,
  recurringOccurrences,
  recurringTemplates,
  settings,
  transactions,
} from '@/db/schema';
import { clearCloudKnowledge, updateSyncState } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  SYNC_BACKUP_FORMAT_VERSION,
  type AnyBackupEnvelope,
  type BackupData,
  type BackupEnvelope,
} from './backup.types';
import { assertCurrentBackup, parseBackupJson, validateBackup } from './backup.validation';

export function createBackup(): BackupEnvelope {
  return assertCurrentBackup(
    validateBackup({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: Constants.expoConfig?.version ?? '0.1.0',
      data: readBackupData(),
    }),
  );
}

/**
 * Portable domain snapshot.
 *
 * Global sync IDs travel with the data so a restore keeps cloud identity.
 * Tombstoned rows are deleted data and are excluded, and the sync runtime state
 * (outbox, cursor, attempt counters, sessions) is never portable.
 *
 * Budgets travel as plans. What was spent against them is absent, because it is
 * derived: the restored transactions reproduce it exactly, and a stored figure
 * could only ever be a way for the file to disagree with them.
 */
export function readBackupData(): BackupData {
  // Reads are performed in one SQLite transaction so the tables describe one logical snapshot.
  return db.transaction((tx) => {
    // Recurring history travels with the live templates it belongs to. A deleted
    // template schedules nothing, so its record of handled dates has nothing
    // left to protect; the transactions it produced stay, as the ordinary
    // transactions they are, without a link to a template the backup does not
    // carry.
    const liveTemplates = tx
      .select()
      .from(recurringTemplates)
      .where(isNull(recurringTemplates.deletedAt))
      .orderBy(asc(recurringTemplates.id))
      .all();
    const liveTemplateIds = new Set(liveTemplates.map((item) => item.id));
    const exportedOccurrences = tx
      .select()
      .from(recurringOccurrences)
      .where(isNull(recurringOccurrences.deletedAt))
      .orderBy(asc(recurringOccurrences.id))
      .all()
      .filter((item) => liveTemplateIds.has(item.templateId));
    const exportedOccurrenceIds = new Set(exportedOccurrences.map((item) => item.id));

    return {
      accounts: tx
        .select()
        .from(accounts)
        .where(isNull(accounts.deletedAt))
        .orderBy(asc(accounts.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'account'),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
        })),
      categories: tx
        .select()
        .from(categories)
        .where(isNull(categories.deletedAt))
        .orderBy(asc(categories.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'category'),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
        })),
      people: tx
        .select()
        .from(people)
        .where(isNull(people.deletedAt))
        .orderBy(asc(people.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'person'),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
        })),
      transactions: tx
        .select()
        .from(transactions)
        .where(isNull(transactions.deletedAt))
        .orderBy(asc(transactions.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'transaction'),
          transactionDate: item.transactionDate.getTime(),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
          recurringOccurrenceId:
            item.recurringOccurrenceId !== null &&
            exportedOccurrenceIds.has(item.recurringOccurrenceId)
              ? item.recurringOccurrenceId
              : null,
        })),
      budgets: tx
        .select()
        .from(budgets)
        .where(isNull(budgets.deletedAt))
        .orderBy(asc(budgets.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'budget'),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
        })),
      // A schedule and its decisions. What is due is not stored: it is recomputed
      // from these after a restore, and comes out the same.
      recurringTemplates: liveTemplates.map(({ deletedAt: _deletedAt, ...item }) => ({
        ...item,
        syncId: requireSyncId(item.syncId, 'recurring template'),
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
      recurringOccurrences: exportedOccurrences.map(({ deletedAt: _deletedAt, ...item }) => ({
        ...item,
        syncId: requireSyncId(item.syncId, 'recurring occurrence'),
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
      settings: tx
        .select()
        .from(settings)
        .where(isNull(settings.deletedAt))
        .orderBy(asc(settings.id))
        .all()
        .map(({ deletedAt: _deletedAt, ...item }) => ({
          ...item,
          syncId: requireSyncId(item.syncId, 'settings record'),
          createdAt: item.createdAt.getTime(),
          updatedAt: item.updatedAt.getTime(),
        })),
      // Migration state belongs to this installation. Only seed/domain metadata is portable.
      appMetadata: tx
        .select()
        .from(appMetadata)
        .where(like(appMetadata.key, 'seed.%'))
        .orderBy(asc(appMetadata.key))
        .all(),
    };
  });
}

export function parseAndValidateBackup(text: string): AnyBackupEnvelope {
  return parseBackupJson(text);
}

/**
 * Replaces all local domain data with the backup contents.
 *
 * A current-format backup keeps its sync IDs so restored rows stay the same
 * cloud records. A pre-M7C backup has no sync IDs, so restore assigns fresh
 * stable ones. Restore is not a user mutation and never queues cloud work: the
 * restored dataset is local data awaiting a future explicit cloud reconciliation.
 */
export function restoreBackup(backup: AnyBackupEnvelope): void {
  const valid = validateBackup(backup);
  const withSyncIds = valid.formatVersion >= SYNC_BACKUP_FORMAT_VERSION;
  // A backup written before budgets existed carries none, which restores as a
  // database with no budgets rather than as a reason to refuse the file.
  const restoredBudgets = 'budgets' in valid.data ? valid.data.budgets : [];
  // The same for recurring data, which only a version 4 backup carries.
  const restoredTemplates = 'recurringTemplates' in valid.data ? valid.data.recurringTemplates : [];
  const restoredOccurrences =
    'recurringOccurrences' in valid.data ? valid.data.recurringOccurrences : [];
  db.transaction((tx) => {
    tx.delete(transactions).run();
    tx.delete(recurringOccurrences).run();
    tx.delete(recurringTemplates).run();
    tx.delete(budgets).run();
    tx.delete(people).run();
    tx.delete(categories).run();
    tx.delete(accounts).run();
    tx.delete(settings).run();
    tx.delete(appMetadata).where(like(appMetadata.key, 'seed.%')).run();
    for (const item of valid.data.accounts)
      tx.insert(accounts)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, withSyncIds, 'account'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.categories)
      tx.insert(categories)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, withSyncIds, 'category'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.people)
      tx.insert(people)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, withSyncIds, 'person'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.settings)
      tx.insert(settings)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, withSyncIds, 'settings record'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    // Templates and their decisions before the transactions that point at them.
    for (const item of restoredTemplates)
      tx.insert(recurringTemplates)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, true, 'recurring template'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of restoredOccurrences)
      tx.insert(recurringOccurrences)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, true, 'recurring occurrence'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.transactions)
      tx.insert(transactions)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, withSyncIds, 'transaction'),
          transactionDate: new Date(item.transactionDate),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of restoredBudgets)
      tx.insert(budgets)
        .values({
          ...item,
          syncId: resolveRestoredSyncId(item, true, 'budget'),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.appMetadata) tx.insert(appMetadata).values(item).run();
    // Queued work referred to the replaced dataset, and the pull position and
    // per-record baselines describe rows that are no longer here.
    clearCloudKnowledge(tx);
    updateSyncState(
      {
        pullCursor: null,
        lastSuccessfulSyncAt: null,
        lastSuccessfulPushAt: null,
        lastSuccessfulPullAt: null,
        lastSyncError: null,
        // A restored dataset has never been agreed with the cloud. Sync stays
        // blocked until the user makes an explicit choice, so an older backup
        // cannot silently overwrite newer cloud data.
        linkedUserId: null,
        pendingLinkUserId: null,
        reconciliationRequired: true,
      },
      tx,
    );
  });
}

/**
 * Keeps a restored global identity when the backup has one; assigns one when it
 * does not. Only a version 1 backup lacks them, and budgets never appear there.
 */
function resolveRestoredSyncId<T extends object>(
  item: T,
  backupHasSyncIds: boolean,
  entity: string,
): string {
  if (!backupHasSyncIds) return createSyncId();
  return requireSyncId((item as { syncId?: unknown }).syncId, entity);
}
