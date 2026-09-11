import { z } from 'zod';

import {
  ACCOUNT_TYPES,
  CATEGORY_TYPES,
  MAX_RECURRENCE_INTERVAL,
  PAYMENT_MODES,
  PERIOD_MONTH_PATTERN,
  RECURRING_FREQUENCIES,
  RECURRING_OCCURRENCE_STATUSES,
  RECURRING_TRANSACTION_TYPES,
} from '@/db/constants';
import { isSyncId } from '@/db/schema';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';
import { isLocalDate } from '@/features/recurring/recurring-schedule';
import { ValidationError } from '@/features/shared/errors';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BUDGET_BACKUP_FORMAT_VERSION,
  BUDGET_BACKUP_SCHEMA_VERSION,
  LEGACY_BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_SCHEMA_VERSION,
  SYNC_BACKUP_FORMAT_VERSION,
  SYNC_BACKUP_SCHEMA_VERSION,
  type AnyBackupEnvelope,
  type BackupBudget,
  type BackupEnvelope,
  type BackupPreview,
  type BackupRecurringOccurrence,
  type BackupRecurringTemplate,
} from './backup.types';

const supportedTransactionTypes = [
  'income',
  'expense',
  'transfer',
  'lend',
  'borrow',
  'repayment_received',
  'repayment_paid',
] as const;
const integer = z.number().int().safe();
const id = integer.positive();
// Account creation normalizes currency codes to uppercase; restore keeps that invariant.
const currency = z.string().regex(/^[A-Z]{3,16}$/);
const timestamp = integer.nonnegative();
const nullableText = z.string().nullable();
// Global identity must be a real UUID: a restored collision would corrupt cloud identity.
const syncId = z.string().refine(isSyncId, 'must be a valid sync identity');
// A scheduled date is a real calendar day, written YYYY-MM-DD.
const localDate = z.string().refine(isLocalDate, 'must be a YYYY-MM-DD calendar date');

const legacyAccountShape = {
  id,
  name: z.string().trim().min(1),
  type: z.enum(ACCOUNT_TYPES),
  openingBalanceMinor: integer,
  currency,
  icon: nullableText,
  isArchived: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const legacyCategoryShape = {
  id,
  name: z.string().trim().min(1),
  type: z.enum(CATEGORY_TYPES),
  icon: nullableText,
  systemKey: nullableText,
  isDefault: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const legacyPersonShape = {
  id,
  name: z.string().trim().min(1),
  note: nullableText,
  isArchived: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const legacyTransactionShape = {
  id,
  type: z.enum(supportedTransactionTypes),
  amountMinor: integer.positive(),
  currency,
  categoryId: id.nullable(),
  sourceAccountId: id.nullable(),
  destinationAccountId: id.nullable(),
  personId: id.nullable(),
  paymentMode: z.enum(PAYMENT_MODES).nullable(),
  transactionDate: timestamp,
  title: z.string(),
  note: nullableText,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const budgetShape = {
  id,
  syncId,
  // Null is the overall monthly budget.
  categoryId: id.nullable(),
  periodMonth: z.string().regex(PERIOD_MONTH_PATTERN),
  amountMinor: integer.positive(),
  currency,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const recurringTemplateShape = {
  id,
  syncId,
  type: z.enum(RECURRING_TRANSACTION_TYPES),
  amountMinor: integer.positive(),
  currency,
  categoryId: id,
  accountId: id,
  paymentMode: z.enum(PAYMENT_MODES).nullable(),
  title: z.string(),
  note: nullableText,
  startDate: localDate,
  frequency: z.enum(RECURRING_FREQUENCIES),
  interval: integer.min(1).max(MAX_RECURRENCE_INTERVAL),
  endDate: localDate.nullable(),
  isPaused: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const recurringOccurrenceShape = {
  id,
  syncId,
  templateId: id,
  occurrenceDate: localDate,
  status: z.enum(RECURRING_OCCURRENCE_STATUSES),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const legacySettingShape = {
  id: z.literal(1),
  defaultCurrency: currency,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const metadataSchema = z
  .object({ key: z.string().startsWith('seed.'), value: z.string() })
  .strict();

const dataSchema = (options: {
  withSyncId: boolean;
  withBudgets: boolean;
  withRecurring: boolean;
}) => {
  const extend = <T extends z.ZodRawShape>(shape: T) =>
    z.object(options.withSyncId ? { ...shape, syncId } : shape).strict();
  const transactionShape = options.withRecurring
    ? { ...legacyTransactionShape, recurringOccurrenceId: id.nullable() }
    : legacyTransactionShape;
  return z
    .object({
      accounts: z.array(extend(legacyAccountShape)),
      categories: z.array(extend(legacyCategoryShape)),
      people: z.array(extend(legacyPersonShape)),
      transactions: z.array(extend(transactionShape)),
      settings: z.array(extend(legacySettingShape)),
      // Absent, not empty, in a backup written before budgets existed. The
      // envelope is `.strict()`, so each version accepts exactly its own shape.
      ...(options.withBudgets ? { budgets: z.array(z.object(budgetShape).strict()) } : {}),
      ...(options.withRecurring
        ? {
            recurringTemplates: z.array(z.object(recurringTemplateShape).strict()),
            recurringOccurrences: z.array(z.object(recurringOccurrenceShape).strict()),
          }
        : {}),
      appMetadata: z.array(metadataSchema),
    })
    .strict();
};

const currentEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    createdAt: z.string().datetime(),
    appVersion: z.string().min(1),
    data: dataSchema({ withSyncId: true, withBudgets: true, withRecurring: true }),
  })
  .strict();
const budgetEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(BUDGET_BACKUP_FORMAT_VERSION),
    schemaVersion: z.literal(BUDGET_BACKUP_SCHEMA_VERSION),
    createdAt: z.string().datetime(),
    appVersion: z.string().min(1),
    data: dataSchema({ withSyncId: true, withBudgets: true, withRecurring: false }),
  })
  .strict();
const syncEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(SYNC_BACKUP_FORMAT_VERSION),
    schemaVersion: z.literal(SYNC_BACKUP_SCHEMA_VERSION),
    createdAt: z.string().datetime(),
    appVersion: z.string().min(1),
    data: dataSchema({ withSyncId: true, withBudgets: false, withRecurring: false }),
  })
  .strict();
const legacyEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(LEGACY_BACKUP_FORMAT_VERSION),
    schemaVersion: z.literal(LEGACY_BACKUP_SCHEMA_VERSION),
    createdAt: z.string().datetime(),
    appVersion: z.string().min(1),
    data: dataSchema({ withSyncId: false, withBudgets: false, withRecurring: false }),
  })
  .strict();
const envelopeSchema = z.discriminatedUnion('formatVersion', [
  legacyEnvelopeSchema,
  syncEnvelopeSchema,
  budgetEnvelopeSchema,
  currentEnvelopeSchema,
]);

export function validateBackup(value: unknown): AnyBackupEnvelope {
  if (
    typeof value === 'object' &&
    value !== null &&
    'formatVersion' in value &&
    typeof (value as { formatVersion?: unknown }).formatVersion === 'number' &&
    (value as { formatVersion: number }).formatVersion > BACKUP_FORMAT_VERSION
  ) {
    throw new ValidationError(
      'This backup was created by a newer or unsupported version of the app and cannot be restored here.',
    );
  }
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError(
      `Backup is invalid: ${parsed.error.issues[0]?.message ?? 'unknown structure error'}`,
    );
  const backup = parsed.data as AnyBackupEnvelope;
  assertUnique(backup.data.accounts, 'accounts');
  assertUnique(backup.data.categories, 'categories');
  assertUnique(backup.data.people, 'people');
  assertUnique(backup.data.transactions, 'transactions');
  assertUnique(backup.data.settings, 'settings');
  assertUnique(budgetsOf(backup), 'budgets');
  assertUnique(recurringTemplatesOf(backup), 'recurring templates');
  assertUnique(recurringOccurrencesOf(backup), 'recurring occurrences');
  if (backup.data.settings.length !== 1)
    throw new ValidationError('Backup must contain exactly one settings record.');
  assertUniqueBy(backup.data.appMetadata, 'app metadata', (item) => item.key);
  assertUniqueSyncIds(backup);
  const systemKeys = backup.data.categories
    .filter((item) => item.systemKey)
    .map((item) => item.systemKey!);
  if (new Set(systemKeys).size !== systemKeys.length)
    throw new ValidationError('Backup contains duplicate category system keys.');
  validateRelationshipsAndDomain(backup);
  return backup;
}

export function isCurrentBackup(backup: AnyBackupEnvelope): backup is BackupEnvelope {
  return backup.formatVersion === BACKUP_FORMAT_VERSION;
}

/** Only versions 3 and 4 carry budgets. */
function budgetsOf(backup: AnyBackupEnvelope): BackupBudget[] {
  return 'budgets' in backup.data ? backup.data.budgets : [];
}

/** Recurring data is the newest collection, so only the current format carries it. */
function recurringTemplatesOf(backup: AnyBackupEnvelope): BackupRecurringTemplate[] {
  return isCurrentBackup(backup) ? backup.data.recurringTemplates : [];
}

function recurringOccurrencesOf(backup: AnyBackupEnvelope): BackupRecurringOccurrence[] {
  return isCurrentBackup(backup) ? backup.data.recurringOccurrences : [];
}

/** Backups this app writes are always the current format. */
export function assertCurrentBackup(backup: AnyBackupEnvelope): BackupEnvelope {
  if (!isCurrentBackup(backup)) {
    throw new ValidationError('Expected a current-format backup.');
  }
  return backup;
}

export function parseBackupJson(text: string): AnyBackupEnvelope {
  try {
    return validateBackup(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValidationError('Backup file is not valid JSON.');
    throw error;
  }
}

export function getBackupPreview(backup: AnyBackupEnvelope): BackupPreview {
  return {
    createdAt: backup.createdAt,
    accounts: backup.data.accounts.length,
    categories: backup.data.categories.length,
    people: backup.data.people.length,
    transactions: backup.data.transactions.length,
    budgets: budgetsOf(backup).length,
    recurringTemplates: recurringTemplatesOf(backup).length,
    currency: backup.data.settings[0]!.defaultCurrency,
  };
}

function assertUnique<T extends { id: number }>(
  items: T[],
  label: string,
  getKey: (item: T) => string | number = (item) => item.id,
) {
  const keys = items.map(getKey);
  if (new Set(keys).size !== keys.length)
    throw new ValidationError(`Backup contains duplicate ${label} IDs.`);
}
function assertUniqueBy<T>(items: T[], label: string, getKey: (item: T) => string | number) {
  const keys = items.map(getKey);
  if (new Set(keys).size !== keys.length)
    throw new ValidationError(`Backup contains duplicate ${label} IDs.`);
}

/**
 * Restored identity collisions would make two records the same row in the cloud,
 * so a duplicate sync ID anywhere in the backup is rejected before any write.
 * Version 1 predates identity and has nothing to check.
 */
function assertUniqueSyncIds(backup: AnyBackupEnvelope) {
  if (backup.formatVersion === LEGACY_BACKUP_FORMAT_VERSION) return;
  const data = backup.data;
  const sets: readonly (readonly [string, readonly { syncId: string }[]])[] = [
    ['accounts', data.accounts],
    ['categories', data.categories],
    ['people', data.people],
    ['transactions', data.transactions],
    ['settings', data.settings],
    ['budgets', budgetsOf(backup)],
    ['recurring templates', recurringTemplatesOf(backup)],
    ['recurring occurrences', recurringOccurrencesOf(backup)],
  ];
  const seen = new Set<string>();
  for (const [label, items] of sets) {
    const keys = items.map((item) => item.syncId);
    if (new Set(keys).size !== keys.length)
      throw new ValidationError(`Backup contains duplicate ${label} sync IDs.`);
    for (const key of keys) {
      if (seen.has(key)) throw new ValidationError('Backup contains duplicate sync IDs.');
      seen.add(key);
    }
  }
}

function validateRelationshipsAndDomain(backup: AnyBackupEnvelope) {
  const accounts = new Map(backup.data.accounts.map((item) => [item.id, item]));
  const categories = new Map(backup.data.categories.map((item) => [item.id, item]));
  const people = new Set(backup.data.people.map((item) => item.id));
  const debtTotals = new Map<
    number,
    { lent: number; borrowed: number; received: number; paid: number; currency?: string }
  >();
  for (const tx of backup.data.transactions) {
    if (tx.categoryId !== null && !categories.has(tx.categoryId))
      throw new ValidationError(`Transaction ${tx.id} references a missing category.`);
    if (tx.sourceAccountId !== null && !accounts.has(tx.sourceAccountId))
      throw new ValidationError(`Transaction ${tx.id} references a missing source account.`);
    if (tx.destinationAccountId !== null && !accounts.has(tx.destinationAccountId))
      throw new ValidationError(`Transaction ${tx.id} references a missing destination account.`);
    if (tx.personId !== null && !people.has(tx.personId))
      throw new ValidationError(`Transaction ${tx.id} references a missing person.`);
    if (tx.type === 'expense' || tx.type === 'income') {
      const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
      if (
        !category ||
        category.type !== tx.type ||
        tx.personId !== null ||
        (tx.type === 'expense'
          ? tx.sourceAccountId === null || tx.destinationAccountId !== null
          : tx.destinationAccountId === null || tx.sourceAccountId !== null)
      )
        throw new ValidationError(`Transaction ${tx.id} has an invalid ${tx.type} relationship.`);
    } else if (tx.type === 'transfer') {
      if (
        tx.categoryId !== null ||
        tx.personId !== null ||
        tx.sourceAccountId === null ||
        tx.destinationAccountId === null ||
        tx.sourceAccountId === tx.destinationAccountId ||
        accounts.get(tx.sourceAccountId)?.currency !==
          accounts.get(tx.destinationAccountId)?.currency ||
        tx.currency !== accounts.get(tx.sourceAccountId)?.currency
      )
        throw new ValidationError(`Transaction ${tx.id} has an invalid transfer relationship.`);
    } else {
      const isOutgoing = tx.type === 'lend' || tx.type === 'repayment_paid';
      const accountId = isOutgoing ? tx.sourceAccountId : tx.destinationAccountId;
      if (
        tx.categoryId !== null ||
        tx.personId === null ||
        accountId === null ||
        (isOutgoing ? tx.destinationAccountId !== null : tx.sourceAccountId !== null) ||
        tx.currency !== accounts.get(accountId)?.currency
      )
        throw new ValidationError(`Transaction ${tx.id} has an invalid debt relationship.`);
      const total = debtTotals.get(tx.personId) ?? { lent: 0, borrowed: 0, received: 0, paid: 0 };
      if (total.currency !== undefined && total.currency !== tx.currency)
        throw new ValidationError('Debt transactions for a person must use one currency.');
      total.currency = tx.currency;
      if (tx.type === 'lend') total.lent += tx.amountMinor;
      if (tx.type === 'borrow') total.borrowed += tx.amountMinor;
      if (tx.type === 'repayment_received') total.received += tx.amountMinor;
      if (tx.type === 'repayment_paid') total.paid += tx.amountMinor;
      if (
        !Number.isSafeInteger(total.lent) ||
        !Number.isSafeInteger(total.borrowed) ||
        !Number.isSafeInteger(total.received) ||
        !Number.isSafeInteger(total.paid)
      )
        throw new ValidationError('Backup debt totals exceed safe integer limits.');
      debtTotals.set(tx.personId, total);
    }
  }
  for (const total of debtTotals.values())
    if (total.received > total.lent || total.paid > total.borrowed)
      throw new ValidationError('Backup contains repayments that exceed the related debt.');
  validateBudgets(backup, categories);
  validateRecurring(backup, accounts, categories);
}

/**
 * Recurring data restores with the transactions it produced, so the rules that
 * keep two devices agreeing about it are checked before anything is written.
 *
 * Every reference must resolve inside the backup, one decision per template and
 * date, one transaction per occurrence — and every identity must be the one
 * derived from what it describes. A backup whose occurrence identity did not
 * match its template and date would restore a record that another device could
 * never converge with.
 *
 * Which category or account a template names is only required to exist, not to
 * still suit it: an account's currency can change after a template was written,
 * and the app reports that as a template that cannot generate, not as a
 * database it refuses to back up.
 */
function validateRecurring(
  backup: AnyBackupEnvelope,
  accounts: Map<number, unknown>,
  categories: Map<number, unknown>,
) {
  if (!isCurrentBackup(backup)) return;
  const templates = new Map(backup.data.recurringTemplates.map((item) => [item.id, item]));
  for (const template of backup.data.recurringTemplates) {
    if (!accounts.has(template.accountId))
      throw new ValidationError(`Recurring template ${template.id} references a missing account.`);
    if (!categories.has(template.categoryId))
      throw new ValidationError(`Recurring template ${template.id} references a missing category.`);
    if (template.endDate !== null && template.endDate < template.startDate)
      throw new ValidationError(`Recurring template ${template.id} ends before it starts.`);
  }

  const occurrences = new Map(backup.data.recurringOccurrences.map((item) => [item.id, item]));
  const decided = new Set<string>();
  for (const occurrence of backup.data.recurringOccurrences) {
    const template = templates.get(occurrence.templateId);
    if (template === undefined)
      throw new ValidationError(
        `Recurring occurrence ${occurrence.id} references a missing template.`,
      );
    const key = `${occurrence.templateId}|${occurrence.occurrenceDate}`;
    if (decided.has(key))
      throw new ValidationError('Backup contains more than one decision for the same date.');
    decided.add(key);
    if (occurrence.syncId !== deriveOccurrenceSyncId(template.syncId, occurrence.occurrenceDate))
      throw new ValidationError(
        `Recurring occurrence ${occurrence.id} has an identity that does not match its template and date.`,
      );
  }

  const claimed = new Set<number>();
  for (const tx of backup.data.transactions) {
    if (tx.recurringOccurrenceId === null) continue;
    const occurrence = occurrences.get(tx.recurringOccurrenceId);
    if (occurrence === undefined)
      throw new ValidationError(`Transaction ${tx.id} references a missing recurring occurrence.`);
    if (tx.type !== 'expense' && tx.type !== 'income')
      throw new ValidationError(`Transaction ${tx.id} cannot be a generated ${tx.type}.`);
    if (claimed.has(occurrence.id))
      throw new ValidationError('Backup contains more than one transaction for one occurrence.');
    claimed.add(occurrence.id);
    if (tx.syncId !== deriveGeneratedTransactionSyncId(occurrence.syncId))
      throw new ValidationError(
        `Transaction ${tx.id} has an identity that does not match its recurring occurrence.`,
      );
  }
}

/**
 * Budgets restore alongside the transactions they measure, so the same rules the
 * service enforces on creation are checked here: a real expense category, and
 * one plan per month, currency and category. A duplicate pair has no meaningful
 * reading, and restoring one would produce a database the app could not have
 * created.
 */
function validateBudgets(backup: AnyBackupEnvelope, categories: Map<number, { type: string }>) {
  const identities = new Set<string>();
  for (const budget of budgetsOf(backup)) {
    if (budget.categoryId !== null) {
      const category = categories.get(budget.categoryId);
      if (category === undefined)
        throw new ValidationError(`Budget ${budget.id} references a missing category.`);
      if (category.type !== 'expense')
        throw new ValidationError(`Budget ${budget.id} references a non-expense category.`);
    }
    // The overall budget's null category is one identity, not many.
    const identity = `${budget.periodMonth}|${budget.currency}|${budget.categoryId ?? 'overall'}`;
    if (identities.has(identity))
      throw new ValidationError('Backup contains more than one budget for the same month.');
    identities.add(identity);
  }
}
