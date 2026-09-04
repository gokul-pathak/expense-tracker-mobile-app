import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { people } from '@/db/schema/people';

import type { CreatePersonRecord, UpdatePersonRecord } from './person.types';

export function getPeople() {
  return db.select().from(people).orderBy(asc(people.id)).all();
}

export function getActivePeople() {
  return db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.id)).all();
}

export function getArchivedPeople() {
  return db.select().from(people).where(eq(people.isArchived, true)).orderBy(asc(people.id)).all();
}

export function getPersonById(id: number) {
  return db.select().from(people).where(eq(people.id, id)).get() ?? null;
}

export function createPerson(data: CreatePersonRecord) {
  return db.insert(people).values(data).returning().get();
}

export function updatePerson(id: number, data: UpdatePersonRecord) {
  return db.update(people).set(data).where(eq(people.id, id)).returning().get() ?? null;
}

export function archivePerson(id: number, updatedAt: Date) {
  return (
    db
      .update(people)
      .set({ isArchived: true, updatedAt })
      .where(eq(people.id, id))
      .returning()
      .get() ?? null
  );
}

export function unarchivePerson(id: number, updatedAt: Date) {
  return (
    db
      .update(people)
      .set({ isArchived: false, updatedAt })
      .where(eq(people.id, id))
      .returning()
      .get() ?? null
  );
}
