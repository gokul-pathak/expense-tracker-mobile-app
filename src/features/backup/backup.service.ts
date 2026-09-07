import Constants from 'expo-constants';
import { asc, isNull, like } from 'drizzle-orm';

import { db } from '@/db';
import { appMetadata, accounts, categories, people, settings, transactions } from '@/db/schema';
import { clearSyncOutbox, updateSyncState } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
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
 */
export function readBackupData(): BackupData {
  // Reads are performed in one SQLite transaction so the tables describe one logical snapshot.
  return db.transaction((tx) => ({
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
  }));
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
  const withSyncIds = valid.formatVersion === BACKUP_FORMAT_VERSION;
  db.transaction((tx) => {
    tx.delete(transactions).run();
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
    for (const item of valid.data.appMetadata) tx.insert(appMetadata).values(item).run();
    // Queued work referred to the replaced dataset, and pull position no longer applies.
    clearSyncOutbox(tx);
    updateSyncState(
      {
        pullCursor: null,
        lastSuccessfulSyncAt: null,
        lastSuccessfulPushAt: null,
        lastSyncError: null,
      },
      tx,
    );
  });
}

/** Keeps a restored global identity when the backup has one; assigns one when it does not. */
function resolveRestoredSyncId<T extends object>(
  item: T,
  backupHasSyncIds: boolean,
  entity: string,
): string {
  if (!backupHasSyncIds) return createSyncId();
  return requireSyncId((item as { syncId?: unknown }).syncId, entity);
}
