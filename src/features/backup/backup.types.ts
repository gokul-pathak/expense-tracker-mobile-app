import type {
  AccountType,
  CategoryType,
  InvestmentAssetType,
  InvestmentTradeType,
  PaymentMode,
  RecurringFrequency,
  RecurringOccurrenceStatus,
  RecurringTransactionType,
  TransactionType,
} from '@/db/constants';

export const BACKUP_FORMAT = 'personal-expense-tracker-backup' as const;
/**
 * Version 5 carries investment assets, trades and manual prices, and each
 * investment cash transaction's link to its trade. Version 4 carries recurring templates, the record of which scheduled dates
 * were generated or skipped, and each generated transaction's link to its
 * occurrence. Version 3 carries budgets. Version 2 carries the stable global
 * `syncId` of every domain row so a restored database keeps its cloud identity
 * instead of being treated as new data. Version 1 predates sync identity.
 *
 * All four remain restorable. A backup written before a feature existed simply
 * has none of its records, which restores as a database without them — the
 * truth about that backup, not a reason to reject it.
 */
export const BACKUP_FORMAT_VERSION = 5 as const;
export const RECURRING_BACKUP_FORMAT_VERSION = 4 as const;
export const BUDGET_BACKUP_FORMAT_VERSION = 3 as const;
export const SYNC_BACKUP_FORMAT_VERSION = 2 as const;
export const LEGACY_BACKUP_FORMAT_VERSION = 1 as const;
// This identifies the newest migration understood by this logical backup format.
export const BACKUP_SCHEMA_VERSION = '20260915120000_investments' as const;
export const RECURRING_BACKUP_SCHEMA_VERSION = '20260911120000_recurring_transactions' as const;
export const BUDGET_BACKUP_SCHEMA_VERSION = '20260909120000_budgets' as const;
export const SYNC_BACKUP_SCHEMA_VERSION = '20260907120000_sync_foundation' as const;
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
  /** The occurrence a generated transaction came from; null for every other. */
  recurringOccurrenceId: number | null;
  /** The investment trade whose cash this is; null for every other. */
  investmentTradeId: number | null;
};
/**
 * A plan, never a figure. What was spent is derived from the restored
 * transactions, so storing it here could only be a way to disagree with them.
 */
export type BackupBudget = {
  id: number;
  syncId: string;
  categoryId: number | null;
  periodMonth: string;
  amountMinor: number;
  currency: string;
  createdAt: number;
  updatedAt: number;
};
/**
 * A recurring plan. What is due is absent: it is the schedule minus the
 * occurrences below, recomputed after a restore exactly as it was before.
 */
export type BackupRecurringTemplate = {
  id: number;
  syncId: string;
  type: RecurringTransactionType;
  amountMinor: number;
  currency: string;
  categoryId: number;
  accountId: number;
  paymentMode: PaymentMode | null;
  title: string;
  note: string | null;
  startDate: string;
  frequency: RecurringFrequency;
  interval: number;
  endDate: string | null;
  isPaused: boolean;
  createdAt: number;
  updatedAt: number;
};
/** A decision about one scheduled date. Only decisions are stored, never future dates. */
export type BackupRecurringOccurrence = {
  id: number;
  syncId: string;
  templateId: number;
  occurrenceDate: string;
  status: RecurringOccurrenceStatus;
  createdAt: number;
  updatedAt: number;
};
/** Something owned. Holdings and value are absent: they are derived from trades and prices. */
export type BackupInvestmentAsset = {
  id: number;
  syncId: string;
  name: string;
  symbol: string | null;
  assetType: InvestmentAssetType;
  currency: string;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};
/** One event in an asset's history. Its replay position is its date, entry time and identity. */
export type BackupInvestmentTrade = {
  id: number;
  syncId: string;
  assetId: number;
  accountId: number;
  tradeType: InvestmentTradeType;
  tradeDate: number;
  quantityMinor: number | null;
  unitPriceMinor: number | null;
  feeMinor: number;
  amountMinor: number | null;
  currency: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};
/** A manual price for one calendar day. */
export type BackupInvestmentPrice = {
  id: number;
  syncId: string;
  assetId: number;
  priceMinor: number;
  priceDate: string;
  currency: string;
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
  budgets: BackupBudget[];
  recurringTemplates: BackupRecurringTemplate[];
  recurringOccurrences: BackupRecurringOccurrence[];
  investmentAssets: BackupInvestmentAsset[];
  investmentTrades: BackupInvestmentTrade[];
  investmentPrices: BackupInvestmentPrice[];
  settings: BackupSetting[];
  appMetadata: BackupMetadata[];
};

/** Pre-M10A shape: recurring data, but no investments and no investment links. */
export type RecurringBackupData = Omit<
  BackupData,
  'transactions' | 'investmentAssets' | 'investmentTrades' | 'investmentPrices'
> & { transactions: Omit<BackupTransaction, 'investmentTradeId'>[] };

/** Pre-M8C shape: budgets, but no recurring data and no transaction links. */
export type BudgetBackupData = Omit<
  RecurringBackupData,
  'transactions' | 'recurringTemplates' | 'recurringOccurrences'
> & { transactions: Omit<BackupTransaction, 'recurringOccurrenceId' | 'investmentTradeId'>[] };

/** Pre-M8A shape: identical domain data, without budgets. */
export type SyncBackupData = Omit<BudgetBackupData, 'budgets'>;

/** Pre-M7C shape: identical domain data, without global sync identity. */
export type LegacyBackupData = {
  accounts: Omit<BackupAccount, 'syncId'>[];
  categories: Omit<BackupCategory, 'syncId'>[];
  people: Omit<BackupPerson, 'syncId'>[];
  transactions: Omit<BackupTransaction, 'syncId' | 'recurringOccurrenceId' | 'investmentTradeId'>[];
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

export type RecurringBackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof RECURRING_BACKUP_FORMAT_VERSION;
  schemaVersion: typeof RECURRING_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: RecurringBackupData;
};

export type BudgetBackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BUDGET_BACKUP_FORMAT_VERSION;
  schemaVersion: typeof BUDGET_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: BudgetBackupData;
};

export type SyncBackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof SYNC_BACKUP_FORMAT_VERSION;
  schemaVersion: typeof SYNC_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: SyncBackupData;
};

export type LegacyBackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof LEGACY_BACKUP_FORMAT_VERSION;
  schemaVersion: typeof LEGACY_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  appVersion: string;
  data: LegacyBackupData;
};

export type AnyBackupEnvelope =
  | BackupEnvelope
  | RecurringBackupEnvelope
  | BudgetBackupEnvelope
  | SyncBackupEnvelope
  | LegacyBackupEnvelope;

export type BackupPreview = {
  createdAt: string;
  accounts: number;
  categories: number;
  people: number;
  transactions: number;
  budgets: number;
  recurringTemplates: number;
  investmentAssets: number;
  currency: string;
};
