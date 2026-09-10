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

/**
 * The secondary line of a transaction row: what the amount was for and where it
 * came from, in one line. The label already says the category or kind, so this
 * line never repeats it.
 */
export function getTransactionSecondaryLine(transaction: TransactionView) {
  const account = transaction.accountName ?? 'Unknown account';
  if (transaction.type === 'transfer') {
    return (
      (transaction.sourceAccountName ?? 'Unknown account') +
      ' → ' +
      (transaction.destinationAccountName ?? 'Unknown account')
    );
  }
  if (transaction.type === 'lend' || transaction.type === 'borrow') {
    return [transaction.personName ?? 'Person', account].join(' · ');
  }
  if (transaction.type === 'repayment_received') {
    return [
      transaction.personName ? transaction.personName + ' paid' : 'Payment received',
      account,
    ].join(' · ');
  }
  if (transaction.type === 'repayment_paid') {
    return [
      transaction.personName ? 'Paid ' + transaction.personName : 'Repayment paid',
      account,
    ].join(' · ');
  }
  const detail = transaction.title || transaction.note;
  return detail ? [detail, account].join(' · ') : account;
}

/** Money direction for colour and sign. Transfers are neutral: nothing changes overall. */
export function getTransactionDirection(
  transaction: Pick<TransactionView, 'type'>,
): 'expense' | 'income' | 'neutral' {
  switch (transaction.type) {
    case 'expense':
    case 'lend':
    case 'repayment_paid':
      return 'expense';
    case 'income':
    case 'borrow':
    case 'repayment_received':
      return 'income';
    default:
      return 'neutral';
  }
}

export type TransactionDayGroup = {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  label: string;
  currency: string;
  /**
   * The day's effect on net worth. Transfers count as zero: money moved between
   * two of your own accounts changes nothing overall, and a day total that said
   * otherwise would be wrong rather than merely noisy.
   */
  netMinor: number;
  transactions: TransactionView[];
};

/**
 * Split a list into calendar days, preserving the order it arrived in. The list
 * is already sorted newest-first by the query, so grouping must not re-sort or
 * a day would surface in the wrong place.
 */
export function groupTransactionsByDay(transactions: TransactionView[]): TransactionDayGroup[] {
  const groups: TransactionDayGroup[] = [];
  const byKey = new Map<string, TransactionDayGroup>();

  for (const transaction of transactions) {
    const key = toDayKey(transaction.transactionDate);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: formatTransactionDateSection(transaction.transactionDate),
        currency: transaction.currency,
        netMinor: 0,
        transactions: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    const direction = getTransactionDirection(transaction);
    if (direction === 'expense') group.netMinor -= transaction.amountMinor;
    else if (direction === 'income') group.netMinor += transaction.amountMinor;
    group.transactions.push(transaction);
  }

  return groups;
}

function toDayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}
