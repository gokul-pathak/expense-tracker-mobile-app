import Constants from 'expo-constants';
import { asc, like } from 'drizzle-orm';

import { db } from '@/db';
import { appMetadata, accounts, categories, people, settings, transactions } from '@/db/schema';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  type BackupData,
  type BackupEnvelope,
} from './backup.types';
import { parseBackupJson, validateBackup } from './backup.validation';

export function createBackup(): BackupEnvelope {
  return validateBackup({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: Constants.expoConfig?.version ?? '0.1.0',
    data: readBackupData(),
  });
}

export function readBackupData(): BackupData {
  // Reads are performed in one SQLite transaction so the tables describe one logical snapshot.
  return db.transaction((tx) => ({
    accounts: tx
      .select()
      .from(accounts)
      .orderBy(asc(accounts.id))
      .all()
      .map((item) => ({
        ...item,
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
    categories: tx
      .select()
      .from(categories)
      .orderBy(asc(categories.id))
      .all()
      .map((item) => ({
        ...item,
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
    people: tx
      .select()
      .from(people)
      .orderBy(asc(people.id))
      .all()
      .map((item) => ({
        ...item,
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
    transactions: tx
      .select()
      .from(transactions)
      .orderBy(asc(transactions.id))
      .all()
      .map((item) => ({
        ...item,
        transactionDate: item.transactionDate.getTime(),
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
      })),
    settings: tx
      .select()
      .from(settings)
      .orderBy(asc(settings.id))
      .all()
      .map((item) => ({
        ...item,
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

export function parseAndValidateBackup(text: string): BackupEnvelope {
  return parseBackupJson(text);
}

export function restoreBackup(backup: BackupEnvelope): void {
  const valid = validateBackup(backup);
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
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.categories)
      tx.insert(categories)
        .values({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.people)
      tx.insert(people)
        .values({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.settings)
      tx.insert(settings)
        .values({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.transactions)
      tx.insert(transactions)
        .values({
          ...item,
          transactionDate: new Date(item.transactionDate),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })
        .run();
    for (const item of valid.data.appMetadata) tx.insert(appMetadata).values(item).run();
  });
}
