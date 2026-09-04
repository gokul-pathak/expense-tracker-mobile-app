import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './settings.repository';

export function getAppSettings() {
  return repository.getSettings() ?? notFound();
}

export function updateDefaultCurrency(currency: string) {
  return repository.updateDefaultCurrency(normalizeCurrency(currency), new Date()) ?? notFound();
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('Default currency is required.');
  }
  return value.trim().toUpperCase();
}

function notFound(): never {
  throw new NotFoundError('Application settings were not found.');
}
