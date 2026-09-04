import { ACCOUNT_TYPES, type AccountType } from '@/db/constants';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './account.repository';
import type {
  CreateAccountInput,
  CreateAccountRecord,
  UpdateAccountInput,
  UpdateAccountRecord,
} from './account.types';

export function listAccounts() {
  return repository.getAccounts();
}

export function listActiveAccounts() {
  return repository.getActiveAccounts();
}

export function listArchivedAccounts() {
  return repository.getArchivedAccounts();
}

export function getAccount(id: number) {
  return repository.getAccountById(id) ?? notFound(id);
}

export function createAccount(input: CreateAccountInput) {
  const now = new Date();
  return repository.createAccount({ ...normalizeCreate(input), createdAt: now, updatedAt: now });
}

export function updateAccount(id: number, input: UpdateAccountInput) {
  const data = normalizeUpdate(input);
  return repository.updateAccount(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

export function archiveAccount(id: number) {
  return repository.archiveAccount(id, new Date()) ?? notFound(id);
}

export function unarchiveAccount(id: number) {
  return repository.unarchiveAccount(id, new Date()) ?? notFound(id);
}

function normalizeCreate(
  input: CreateAccountInput,
): Omit<CreateAccountRecord, 'createdAt' | 'updatedAt'> {
  return {
    name: normalizeRequiredText(input.name, 'Account name'),
    type: normalizeAccountType(input.type),
    openingBalanceMinor: normalizeOpeningBalance(input.openingBalanceMinor),
    currency: normalizeCurrency(input.currency),
    icon: normalizeOptionalText(input.icon),
  };
}

function normalizeUpdate(input: UpdateAccountInput): Omit<UpdateAccountRecord, 'updatedAt'> {
  const data: Omit<UpdateAccountRecord, 'updatedAt'> = {};

  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one account field to update.');
  }
  if (input.name !== undefined) data.name = normalizeRequiredText(input.name, 'Account name');
  if (input.type !== undefined) data.type = normalizeAccountType(input.type);
  if (input.openingBalanceMinor !== undefined) {
    data.openingBalanceMinor = normalizeOpeningBalance(input.openingBalanceMinor);
  }
  if (input.currency !== undefined) data.currency = normalizeCurrency(input.currency);
  if (input.icon !== undefined) data.icon = normalizeOptionalText(input.icon);

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Provide at least one permitted account field to update.');
  }

  return data;
}

function normalizeAccountType(value: unknown): AccountType {
  if (typeof value !== 'string' || !ACCOUNT_TYPES.includes(value as AccountType)) {
    throw new ValidationError('Account type is invalid.');
  }
  return value as AccountType;
}

function normalizeOpeningBalance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('Opening balance must be an integer number of minor units.');
  }
  return value;
}

function normalizeCurrency(value: unknown): string {
  return normalizeRequiredText(value, 'Currency').toUpperCase();
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError('Icon must be text.');
  return value.trim() || null;
}

function notFound(id: number): never {
  throw new NotFoundError(`Account ${id} was not found.`);
}
