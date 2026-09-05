import type { TransactionView } from './transaction.types';

export type TransactionListFilters = {
  search: string;
  type: 'all' | 'expense' | 'income';
  date: 'all' | 'today' | 'week' | 'month';
  categoryId?: number;
  accountId?: number;
};

export function filterTransactionViews(
  transactions: TransactionView[],
  filters: TransactionListFilters,
) {
  const query = filters.search.trim().toLocaleLowerCase();
  return transactions.filter((transaction) => {
    const searchable = [
      transaction.categoryName,
      transaction.accountName,
      transaction.title,
      transaction.note,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    return (
      (filters.type === 'all' || transaction.type === filters.type) &&
      (!query || searchable.includes(query)) &&
      (filters.categoryId === undefined || transaction.categoryId === filters.categoryId) &&
      (filters.accountId === undefined || transaction.accountId === filters.accountId) &&
      matchesDate(transaction.transactionDate, filters.date)
    );
  });
}

function matchesDate(value: Date, filter: TransactionListFilters['date']) {
  if (filter === 'all') return true;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (filter === 'today') return value >= startToday;
  if (filter === 'week') {
    const startWeek = new Date(startToday);
    startWeek.setDate(startToday.getDate() - ((startToday.getDay() + 6) % 7));
    return value >= startWeek;
  }
  return value.getFullYear() === today.getFullYear() && value.getMonth() === today.getMonth();
}
