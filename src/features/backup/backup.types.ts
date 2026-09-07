import type { AccountType, CategoryType, PaymentMode, TransactionType } from '@/db/constants';

export const BACKUP_FORMAT = 'personal-expense-tracker-backup' as const;
/**
 * Version 2 carries the stable global `syncId` of every domain row so a restored
 * database keeps its cloud identity instead of being treated as new data.
 * Version 1 backups predate sync identity and remain restorable.
 */
export const BACKUP_FORMAT_VERSION = 2 as const;
export const LEGACY_BACKUP_FORMAT_VERSION = 1 as const;
// This identifies the newest migration understood by this logical backup format.
export const BACKUP_SCHEMA_VERSION = '20260907120000_sync_foundation' as const;
export const LEGACY_BACKUP_SCHEMA_VERSION = '20260904151616_damp_raider' as const;

export type BackupAccount = {
  id: number;
  syncId: string;
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  currency: string;
  icon: string | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};
export type BackupCategory = {
  id: number;
  syncId: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  systemKey: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};
export type BackupPerson = {
  id: number;
  syncId: string;
  name: string;
  note: string | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};
export type BackupTransaction = {
  id: number;
  syncId: string;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  categoryId: number | null;
  sourceAccountId: number | null;
  destinationAccountId: number | null;
  personId: number | null;
  paymentMode: PaymentMode | null;
  transactionDate: number;
  title: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};
export type BackupSetting = {
  id: number;
  syncId: string;
  defaultCurrency: string;
  createdAt: number;
  updatedAt: number;
};
export type BackupMetadata = { key: string; value: string };

export type BackupData = {
  accounts: BackupAccount[];
  categories: BackupCategory[];
  people: BackupPerson[];
  transactions: BackupTransaction[];
  settings: BackupSetting[];
  appMetadata: BackupMetadata[];
};

/** Pre-M7C shape: identical domain data, without global sync identity. */
export type LegacyBackupData = {
  accounts: Omit<BackupAccount, 'syncId'>[];
  categories: Omit<BackupCategory, 'syncId'>[];
  people: Omit<BackupPerson, 'syncId'>[];
  transactions: Omit<BackupTransaction, 'syncId'>[];
  settings: Omit<BackupSetting, 'syncId'>[];
  appMetadata: BackupMetadata[];
};

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: BackupData;
};

export type LegacyBackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof LEGACY_BACKUP_FORMAT_VERSION;
  schemaVersion: typeof LEGACY_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: LegacyBackupData;
};

export type AnyBackupEnvelope = BackupEnvelope | LegacyBackupEnvelope;

export type BackupPreview = {
  createdAt: string;
  accounts: number;
  categories: number;
  people: number;
  transactions: number;
  currency: string;
};
