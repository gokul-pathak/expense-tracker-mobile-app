import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import type { NewPerson } from '@/db/schema/people';
import { people } from '@/db/schema/people';
import { enqueueSyncMutation } from '@/features/sync/sync.repository';
import { createSyncId, requireSyncId } from '@/features/sync/uuid';

import type { CreatePersonRecord, UpdatePersonRecord } from './person.types';

type PersonWrite = UpdatePersonRecord & Partial<Pick<NewPerson, 'isArchived'>>;

const live = isNull(people.deletedAt);

export function getPeople() {
  return db.select().from(people).where(live).orderBy(asc(people.id)).all();
}

export function getActivePeople() {
  return db
    .select()
    .from(people)
    .where(and(live, eq(people.isArchived, false)))
    .orderBy(asc(people.id))
    .all();
}

export function getArchivedPeople() {
  return db
    .select()
    .from(people)
    .where(and(live, eq(people.isArchived, true)))
    .orderBy(asc(people.id))
    .all();
}

export function getPersonById(id: number) {
  return (
    db
      .select()
      .from(people)
      .where(and(live, eq(people.id, id)))
      .get() ?? null
  );
}

export function createPerson(data: CreatePersonRecord) {
  const syncId = createSyncId();
  return db.transaction((tx) => {
    const person = tx
      .insert(people)
      .values({ ...data, syncId })
      .returning()
      .get();
    enqueueSyncMutation(tx, { entityType: 'person', entitySyncId: syncId, operation: 'upsert' });
    return person;
  });
}

export function updatePerson(id: number, data: UpdatePersonRecord) {
  return writePerson(id, data);
}

export function archivePerson(id: number, updatedAt: Date) {
  // Archiving hides a person from pickers but never deletes them from the cloud.
  return writePerson(id, { isArchived: true, updatedAt });
}

export function unarchivePerson(id: number, updatedAt: Date) {
  return writePerson(id, { isArchived: false, updatedAt });
}

function writePerson(id: number, data: PersonWrite) {
  return db.transaction((tx) => {
    const person =
      tx
        .update(people)
        .set(data)
        .where(and(live, eq(people.id, id)))
        .returning()
        .get() ?? null;
    if (person === null) return null;
    enqueueSyncMutation(tx, {
      entityType: 'person',
      entitySyncId: requireSyncId(person.syncId, 'person'),
      operation: 'upsert',
    });
    return person;
  });
}
