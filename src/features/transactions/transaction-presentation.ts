import type { TransactionView } from './transaction.types';

export function getTransactionLabel(transaction: TransactionView) {
  return transaction.categoryName ?? 'Unknown category';
}

export function getTransactionAccountLabel(transaction: TransactionView) {
  return transaction.accountName ?? 'Unknown account';
}

export function getTransactionDescription(transaction: TransactionView) {
  return (
    transaction.title || transaction.note || (transaction.type === 'expense' ? 'Expense' : 'Income')
  );
}

export function formatTransactionDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatTransactionDateSection(date: Date) {
  const today = startOfDay(new Date());
  const value = startOfDay(date);
  const difference = Math.round((today.getTime() - value.getTime()) / 86_400_000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return formatTransactionDate(date);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
