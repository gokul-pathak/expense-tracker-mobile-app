import type { BackupData } from '@/features/backup/backup.types';

export function transactionsToCsv(data: BackupData): string {
  const accounts = new Map(data.accounts.map((item) => [item.id, item.name]));
  const categories = new Map(data.categories.map((item) => [item.id, item.name]));
  const people = new Map(data.people.map((item) => [item.id, item.name]));
  const header = [
    'id',
    'type',
    'amount',
    'amount_minor',
    'currency',
    'category',
    'source_account',
    'destination_account',
    'person',
    'payment_mode',
    'transaction_date',
    'title',
    'note',
    'created_at',
    'updated_at',
  ];
  const rows = data.transactions.map((item) => [
    item.id,
    item.type,
    formatMinorForCsv(item.amountMinor),
    item.amountMinor,
    item.currency,
    item.categoryId === null ? '' : (categories.get(item.categoryId) ?? ''),
    item.sourceAccountId === null ? '' : (accounts.get(item.sourceAccountId) ?? ''),
    item.destinationAccountId === null ? '' : (accounts.get(item.destinationAccountId) ?? ''),
    item.personId === null ? '' : (people.get(item.personId) ?? ''),
    item.paymentMode ?? '',
    new Date(item.transactionDate).toISOString(),
    item.title,
    item.note ?? '',
    new Date(item.createdAt).toISOString(),
    new Date(item.updatedAt).toISOString(),
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

export function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function formatMinorForCsv(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
