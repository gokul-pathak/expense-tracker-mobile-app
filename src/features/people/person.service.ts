import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './person.repository';
import type {
  CreatePersonInput,
  CreatePersonRecord,
  UpdatePersonInput,
  UpdatePersonRecord,
} from './person.types';

export function listPeople() {
  return repository.getPeople();
}

export function listActivePeople() {
  return repository.getActivePeople();
}

export function listArchivedPeople() {
  return repository.getArchivedPeople();
}

export function getPerson(id: number) {
  return repository.getPersonById(id) ?? notFound(id);
}

export function createPerson(input: CreatePersonInput) {
  const now = new Date();
  return repository.createPerson({ ...normalizeCreate(input), createdAt: now, updatedAt: now });
}

export function updatePerson(id: number, input: UpdatePersonInput) {
  const data = normalizeUpdate(input);
  return repository.updatePerson(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

export function archivePerson(id: number) {
  return repository.archivePerson(id, new Date()) ?? notFound(id);
}

export function unarchivePerson(id: number) {
  return repository.unarchivePerson(id, new Date()) ?? notFound(id);
}

function normalizeCreate(
  input: CreatePersonInput,
): Omit<CreatePersonRecord, 'createdAt' | 'updatedAt'> {
  return {
    name: normalizeRequiredText(input.name, 'Person name'),
    note: normalizeOptionalText(input.note),
  };
}

function normalizeUpdate(input: UpdatePersonInput): Omit<UpdatePersonRecord, 'updatedAt'> {
  const data: Omit<UpdatePersonRecord, 'updatedAt'> = {};

  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one person field to update.');
  }
  if (input.name !== undefined) data.name = normalizeRequiredText(input.name, 'Person name');
  if (input.note !== undefined) data.note = normalizeOptionalText(input.note);

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Provide at least one permitted person field to update.');
  }

  return data;
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError('Person note must be text.');
  return value.trim() || null;
}

function notFound(id: number): never {
  throw new NotFoundError(`Person ${id} was not found.`);
}
