import type { TransactionView } from './transaction.types';

export function getTransactionLabel(transaction: TransactionView) {
  if (transaction.type === 'expense' || transaction.type === 'income') {
    return transaction.categoryName ?? 'Uncategorized';
  }
  if (transaction.type === 'transfer') return 'Transfer';
  if (transaction.type === 'lend') return 'Money Given';
  if (transaction.type === 'borrow') return 'Money Taken';
  if (transaction.type === 'repayment_received') return 'Payment Received';
  if (transaction.type === 'repayment_paid') return 'Repayment';
  return transaction.title;
}

export function getTransactionAccountLabel(transaction: TransactionView) {
  return transaction.accountName ?? 'Unknown account';
}

export function getTransactionDescription(transaction: TransactionView) {
  if (transaction.type === 'transfer') {
    return `${transaction.sourceAccountName ?? 'Unknown account'} -> ${transaction.destinationAccountName ?? 'Unknown account'}`;
  }
  if (transaction.type === 'lend' || transaction.type === 'borrow')
    return transaction.personName ?? 'Person';
  if (transaction.type === 'repayment_received')
    return transaction.personName ? `${transaction.personName} paid` : 'Payment received';
  if (transaction.type === 'repayment_paid')
    return transaction.personName ? `You paid ${transaction.personName}` : 'Repayment paid';
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
