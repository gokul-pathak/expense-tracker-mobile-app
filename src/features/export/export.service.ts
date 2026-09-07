import { readBackupData } from '@/features/backup/backup.service';
import { transactionsToCsv } from './export.types';

export function exportTransactionsCsv(): string {
  return transactionsToCsv(readBackupData());
}

export function exportTransactionsJson(): string {
  return JSON.stringify(
    {
      format: 'personal-expense-tracker-transactions-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: readBackupData().transactions,
    },
    null,
    2,
  );
}
export function exportFullDataJson(): string {
  return JSON.stringify(
    {
      format: 'personal-expense-tracker-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      ...readBackupData(),
    },
    null,
    2,
  );
}
