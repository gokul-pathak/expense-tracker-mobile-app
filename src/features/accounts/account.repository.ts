import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { db } from '@/db';
import type { NewAccount } from '@/db/schema/accounts';
import { accounts } from '@/db/schema/accounts';
import { transactions } from '@/db/schema/transactions';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import type { CreateAccountRecord, UpdateAccountRecord } from './account.types';

type AccountWrite = UpdateAccountRecord & Partial<Pick<NewAccount, 'isArchived'>>;

const live = isNull(accounts.deletedAt);

export function getAccounts() {
  return db.select().from(accounts).where(live).orderBy(asc(accounts.id)).all();
}

export function getActiveAccounts() {
  return db
    .select()
    .from(accounts)
    .where(and(live, eq(accounts.isArchived, false)))
    .orderBy(asc(accounts.id))
    .all();
}

export function getArchivedAccounts() {
  return db
    .select()
    .from(accounts)
    .where(and(live, eq(accounts.isArchived, true)))
    .orderBy(asc(accounts.id))
    .all();
}

export function getAccountById(id: number) {
  return (
    db
      .select()
      .from(accounts)
      .where(and(live, eq(accounts.id, id)))
      .get() ?? null
  );
}

export function hasFinancialHistory(id: number) {
  return (
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          or(eq(transactions.sourceAccountId, id), eq(transactions.destinationAccountId, id)),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function createAccount(data: CreateAccountRecord) {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const account = tx
      .insert(accounts)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, {
      entityType: 'account',
      entitySyncId: syncId,
      operation: 'upsert',
    });
    return account;
  });
}

export function updateAccount(id: number, data: UpdateAccountRecord) {
  return writeAccount(id, data);
}

export function archiveAccount(id: number, updatedAt: Date) {
  // Archiving keeps the account and its history: it syncs as a normal upsert.
  return writeAccount(id, { isArchived: true, updatedAt });
}

export function unarchiveAccount(id: number, updatedAt: Date) {
  return writeAccount(id, { isArchived: false, updatedAt });
}

function writeAccount(id: number, data: AccountWrite) {
  return db.transaction((tx) => {
    const account =
      tx
        .update(accounts)
        .set(data)
        .where(and(live, eq(accounts.id, id)))
        .returning()
        .get() ?? null;
    if (account === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'account',
      entitySyncId: requireSyncId(account.syncId, 'account'),
      operation: 'upsert',
    });
    return account;
  });
}
