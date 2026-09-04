import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';

import type { CreateAccountRecord, UpdateAccountRecord } from './account.types';

export function getAccounts() {
  return db.select().from(accounts).orderBy(asc(accounts.id)).all();
}

export function getActiveAccounts() {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.isArchived, false))
    .orderBy(asc(accounts.id))
    .all();
}

export function getArchivedAccounts() {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.isArchived, true))
    .orderBy(asc(accounts.id))
    .all();
}

export function getAccountById(id: number) {
  return db.select().from(accounts).where(eq(accounts.id, id)).get() ?? null;
}

export function createAccount(data: CreateAccountRecord) {
  return db.insert(accounts).values(data).returning().get();
}

export function updateAccount(id: number, data: UpdateAccountRecord) {
  return db.update(accounts).set(data).where(eq(accounts.id, id)).returning().get() ?? null;
}

export function archiveAccount(id: number, updatedAt: Date) {
  return (
    db
      .update(accounts)
      .set({ isArchived: true, updatedAt })
      .where(eq(accounts.id, id))
      .returning()
      .get() ?? null
  );
}

export function unarchiveAccount(id: number, updatedAt: Date) {
  return (
    db
      .update(accounts)
      .set({ isArchived: false, updatedAt })
      .where(eq(accounts.id, id))
      .returning()
      .get() ?? null
  );
}
