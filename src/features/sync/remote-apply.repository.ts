import { eq } from 'drizzle-orm';

import { db } from '@/db';
import type { AccountType, CategoryType, PaymentMode, TransactionType } from '@/db/constants';
import { accounts, categories, people, settings, transactions } from '@/db/schema';
import type { SyncEntityType } from '@/db/schema';

import type { SyncWriter } from './sync.types';
import { requireSyncId } from './uuid';

/**
 * Remote-apply path.
 *
 * Everything in this module writes rows that originated on another device.
 * It deliberately never calls `enqueueSyncMutation`, so applying a downloaded
 * change can never queue the same record straight back for upload. Origin is
 * expressed by calling these functions instead of the domain repositories —
 * there is no global "currently syncing" flag that could be left set.
 *
 * M7C provides the local apply primitives and their tests only. No network
 * Pull Sync calls them yet.
 */

const SETTINGS_ID = 1;

export type RemoteAccount = {
  syncId: string;
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  currency: string;
  icon: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

export type RemoteCategory = {
  syncId: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  systemKey: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

export type RemotePerson = {
  syncId: string;
  name: string;
  note: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

export type RemoteSettings = {
  syncId: string;
  defaultCurrency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

/** Remote transactions reference other rows by global sync ID, never local IDs. */
export type RemoteTransaction = {
  syncId: string;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  categorySyncId: string | null;
  sourceAccountSyncId: string | null;
  destinationAccountSyncId: string | null;
  personSyncId: string | null;
  paymentMode: PaymentMode | null;
  transactionDate: Date;
  title: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
};

export type RemoteTombstone = {
  entityType: SyncEntityType;
  syncId: string;
  deletedAt: Date;
};

export type RemoteChangeBatch = {
  settings?: RemoteSettings[];
  accounts?: RemoteAccount[];
  categories?: RemoteCategory[];
  people?: RemotePerson[];
  transactions?: RemoteTransaction[];
  tombstones?: RemoteTombstone[];
};

/** Applies one validated batch in dependency-safe order inside a single transaction. */
export function applyRemoteChanges(batch: RemoteChangeBatch) {
  return db.transaction((tx) => {
    for (const row of batch.settings ?? []) applyRemoteSettings(row, tx);
    for (const row of batch.accounts ?? []) applyRemoteAccount(row, tx);
    for (const row of batch.categories ?? []) applyRemoteCategory(row, tx);
    for (const row of batch.people ?? []) applyRemotePerson(row, tx);
    for (const row of batch.transactions ?? []) applyRemoteTransaction(row, tx);
    for (const row of batch.tombstones ?? []) applyRemoteTombstone(row, tx);
  });
}

export function applyRemoteAccount(row: RemoteAccount, writer: SyncWriter = db) {
  const syncId = requireSyncId(row.syncId, 'remote account');
  const values = {
    name: row.name,
    type: row.type,
    openingBalanceMinor: row.openingBalanceMinor,
    currency: row.currency,
    icon: row.icon,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
  writer
    .insert(accounts)
    .values({ ...values, syncId })
    .onConflictDoUpdate({ target: accounts.syncId, set: values })
    .run();
}

/**
 * Built-in categories reconcile by `system_key` so a downloaded default never
 * duplicates an already-seeded one. The remote sync ID becomes the shared identity.
 */
export function applyRemoteCategory(row: RemoteCategory, writer: SyncWriter = db) {
  const syncId = requireSyncId(row.syncId, 'remote category');
  const values = {
    name: row.name,
    type: row.type,
    icon: row.icon,
    systemKey: row.systemKey,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };

  if (row.systemKey !== null) {
    const seeded = writer
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.systemKey, row.systemKey))
      .get();
    if (seeded !== undefined) {
      writer
        .update(categories)
        .set({ ...values, syncId })
        .where(eq(categories.id, seeded.id))
        .run();
      return;
    }
  }

  writer
    .insert(categories)
    .values({ ...values, syncId })
    .onConflictDoUpdate({ target: categories.syncId, set: values })
    .run();
}

export function applyRemotePerson(row: RemotePerson, writer: SyncWriter = db) {
  const syncId = requireSyncId(row.syncId, 'remote person');
  const values = {
    name: row.name,
    note: row.note,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
  writer
    .insert(people)
    .values({ ...values, syncId })
    .onConflictDoUpdate({ target: people.syncId, set: values })
    .run();
}

/** Settings is one local singleton row; the remote record supplies its identity. */
export function applyRemoteSettings(row: RemoteSettings, writer: SyncWriter = db) {
  const syncId = requireSyncId(row.syncId, 'remote settings record');
  const values = {
    defaultCurrency: row.defaultCurrency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
  writer
    .insert(settings)
    .values({ ...values, id: SETTINGS_ID, syncId })
    .onConflictDoUpdate({ target: settings.id, set: { ...values, syncId } })
    .run();
}

export function applyRemoteTransaction(row: RemoteTransaction, writer: SyncWriter = db) {
  const syncId = requireSyncId(row.syncId, 'remote transaction');
  const values = {
    type: row.type,
    amountMinor: row.amountMinor,
    currency: row.currency,
    categoryId: resolveLocalId(writer, 'category', row.categorySyncId),
    sourceAccountId: resolveLocalId(writer, 'account', row.sourceAccountSyncId),
    destinationAccountId: resolveLocalId(writer, 'account', row.destinationAccountSyncId),
    personId: resolveLocalId(writer, 'person', row.personSyncId),
    paymentMode: row.paymentMode,
    transactionDate: row.transactionDate,
    title: row.title,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
  writer
    .insert(transactions)
    .values({ ...values, syncId })
    .onConflictDoUpdate({ target: transactions.syncId, set: values })
    .run();
}

/** Hides a row deleted on another device. Domain queries stop returning it at once. */
export function applyRemoteTombstone(tombstone: RemoteTombstone, writer: SyncWriter = db) {
  const syncId = requireSyncId(tombstone.syncId, `remote ${tombstone.entityType}`);
  const deletedAt = tombstone.deletedAt;
  switch (tombstone.entityType) {
    case 'account':
      writer.update(accounts).set({ deletedAt }).where(eq(accounts.syncId, syncId)).run();
      return;
    case 'category':
      writer.update(categories).set({ deletedAt }).where(eq(categories.syncId, syncId)).run();
      return;
    case 'person':
      writer.update(people).set({ deletedAt }).where(eq(people.syncId, syncId)).run();
      return;
    case 'transaction':
      writer.update(transactions).set({ deletedAt }).where(eq(transactions.syncId, syncId)).run();
      return;
    case 'settings':
      writer.update(settings).set({ deletedAt }).where(eq(settings.syncId, syncId)).run();
      return;
  }
}

function resolveLocalId(
  writer: SyncWriter,
  entityType: 'account' | 'category' | 'person',
  syncId: string | null,
): number | null {
  if (syncId === null) return null;
  const table =
    entityType === 'account' ? accounts : entityType === 'category' ? categories : people;
  const row = writer.select({ id: table.id }).from(table).where(eq(table.syncId, syncId)).get();
  if (row === undefined) {
    throw new Error(`Remote transaction references an unknown ${entityType}.`);
  }
  return row.id;
}
