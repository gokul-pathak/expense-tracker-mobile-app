import type { AccountType, CategoryType, PaymentMode, TransactionType } from '@/db/constants';

export const BACKUP_FORMAT = 'personal-expense-tracker-backup' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
// This identifies the newest migration understood by this logical backup format.
export const BACKUP_SCHEMA_VERSION = '20260904151616_damp_raider' as const;

export type BackupAccount = {
  id: number;
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
  name: string;
  note: string | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};
export type BackupTransaction = {
  id: number;
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

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: string;
  createdAt: string;
  appVersion: string;
  data: BackupData;
};

export type BackupPreview = {
  createdAt: string;
  accounts: number;
  categories: number;
  people: number;
  transactions: number;
  currency: string;
};
