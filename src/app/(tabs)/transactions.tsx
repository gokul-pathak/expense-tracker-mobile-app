import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BottomSheet,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LargeTitle,
  ListRow,
  Money,
  NativeDataNotice,
  Screen,
  SearchField,
  SectionHeader,
  Skeleton,
  Text,
  TransactionRow,
} from '@/components/ui';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import { filterTransactionViews } from '@/features/transactions/transaction-list-filter';
import {
  getTransactionAccountLabel,
  getTransactionLabel,
  groupTransactionsByDay,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';
import { isLocalFinanceDataAvailable, listTransactionViews } from '@/features/ui/data';
import { useTheme } from '@/theme';

type TypeFilter = 'all' | 'expense' | 'income';
type DateFilter = 'all' | 'today' | 'week' | 'month';

const typeFilters: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

const dateFilters: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

export default function TransactionsScreen() {
  const { space } = useTheme();
  const quickAdd = useQuickAdd();
  const [transactions, setTransactions] = useState<TransactionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [date, setDate] = useState<DateFilter>('all');
  const [categoryId, setCategoryId] = useState<number>();
  const [accountId, setAccountId] = useState<number>();
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setTransactions(listTransactionViews());
    } catch (error) {
      console.error('Could not load transactions.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  const visible = useMemo(
    () => filterTransactionViews(transactions, { search, type, date, categoryId, accountId }),
    [transactions, search, type, date, categoryId, accountId],
  );
  const groups = useMemo(() => groupTransactionsByDay(visible), [visible]);

  const clearFilters = useCallback(() => {
    setType('all');
    setDate('all');
    setCategoryId(undefined);
    setAccountId(undefined);
  }, []);

  const narrowed =
    type !== 'all' || date !== 'all' || categoryId !== undefined || accountId !== undefined;

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen tabBar>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (loading) {
    return (
      <Screen scroll tabBar>
        <TransactionsSkeleton />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Screen tabBar>
        <ErrorState
          message="Your local transaction history could not be read. Your data is safe."
          onRetry={load}
        />
      </Screen>
    );
  }

  const filterSheet = (
    <FilterSheet
      visible={showFilters}
      onClose={() => setShowFilters(false)}
      transactions={transactions}
      type={type}
      date={date}
      setDate={setDate}
      categoryId={categoryId}
      setCategoryId={setCategoryId}
      accountId={accountId}
      setAccountId={setAccountId}
      narrowed={narrowed}
      onClear={clearFilters}
    />
  );

  const header = (
    <>
      <LargeTitle
        title="Transactions"
        action={{
          icon: 'sliders-horizontal',
          onPress: () => setShowFilters(true),
          accessibilityLabel: 'Filter transactions',
          badge: narrowed,
        }}
      />
      <View style={{ marginTop: space.lg }}>
        <SearchField
          accessibilityLabel="Search transactions"
          placeholder="Search transactions"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <View style={[styles.chips, { marginTop: space.md + 2, gap: space.sm }]}>
        {typeFilters.map((filter) => (
          <Chip
            key={filter.value}
            label={filter.label}
            selected={type === filter.value}
            onPress={() => setType(filter.value)}
          />
        ))}
      </View>
    </>
  );

  // An empty database and an empty result are different problems with different
  // exits: one wants a first transaction, the other wants its filters back.
  if (transactions.length === 0) {
    return (
      <Screen scroll tabBar>
        {header}
        <EmptyState
          illustration="ledger"
          title="No transactions yet"
          body="Every expense, income, transfer and loan you record shows up here, newest first."
          action={{ label: 'Add Transaction', onPress: quickAdd.open }}
        />
        {filterSheet}
      </Screen>
    );
  }

  return (
    <Screen scroll tabBar>
      {header}
      {groups.length === 0 ? (
        <EmptyState
          illustration="arcs"
          title="Nothing matches"
          body={
            narrowed
              ? 'No transaction fits the filters you have set.'
              : 'No transaction matches that search.'
          }
          action={narrowed ? { label: 'Clear Filters', onPress: clearFilters } : undefined}
        />
      ) : (
        groups.map((group) => (
          <View key={group.key} style={{ marginTop: space.xxl - 2 }}>
            <SectionHeader
              title={group.label}
              tone="secondary"
              style={{ marginBottom: space.xs + 2 }}
              trailing={
                <Money
                  minorUnits={Math.abs(group.netMinor)}
                  currency={group.currency}
                  size="row"
                  direction={group.netMinor < 0 ? 'expense' : 'income'}
                  muted
                  style={styles.dayTotal}
                />
              }
            />
            <Card padding="none">
              {group.transactions.map((transaction, index) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  last={index === group.transactions.length - 1}
                  onPress={() => router.push(('/transaction/' + transaction.id) as never)}
                />
              ))}
            </Card>
          </View>
        ))
      )}
      {filterSheet}
    </Screen>
  );
}

type FilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  transactions: TransactionView[];
  type: TypeFilter;
  date: DateFilter;
  setDate: (value: DateFilter) => void;
  categoryId?: number;
  setCategoryId: (value: number | undefined) => void;
  accountId?: number;
  setAccountId: (value: number | undefined) => void;
  narrowed: boolean;
  onClear: () => void;
};

/**
 * Period, category and account. The type chips stay on the screen itself
 * because they are the filter people reach for constantly, and burying them one
 * tap deeper would be the wrong trade.
 *
 * Category and account options come from the transactions that exist rather
 * than from the full seeded lists, so the sheet never offers a filter that
 * would return nothing.
 */
function FilterSheet({
  visible,
  onClose,
  transactions,
  type,
  date,
  setDate,
  categoryId,
  setCategoryId,
  accountId,
  setAccountId,
  narrowed,
  onClear,
}: FilterSheetProps) {
  const { space } = useTheme();
  const categoryPool =
    type === 'all' ? transactions : transactions.filter((item) => item.type === type);
  const categories = uniqueBy(categoryPool, (item) => item.categoryId).filter(
    (item) => item.categoryId !== null,
  );
  const accounts = uniqueBy(transactions, (item) => item.accountId).filter(
    (item) => item.accountId !== null,
  );

  return (
    <BottomSheet scroll visible={visible} onClose={onClose} title="Filters">
      <SectionHeader
        title="Period"
        action={narrowed ? { label: 'Clear all', onPress: onClear } : undefined}
      />
      <View style={[styles.chips, { gap: space.sm, marginBottom: space.xxl }]}>
        {dateFilters.map((filter) => (
          <Chip
            key={filter.value}
            label={filter.label}
            selected={date === filter.value}
            onPress={() => setDate(filter.value)}
          />
        ))}
      </View>

      <SectionHeader title="Category" />
      <Card padding="none" style={{ marginBottom: space.xxl }}>
        <ListRow
          label="Any category"
          chevron={false}
          trailing={categoryId === undefined ? <Selected /> : undefined}
          onPress={() => setCategoryId(undefined)}
          last={categories.length === 0}
        />
        {categories.map((item, index) => (
          <ListRow
            key={item.categoryId}
            label={getTransactionLabel(item)}
            chevron={false}
            trailing={categoryId === item.categoryId ? <Selected /> : undefined}
            onPress={() => setCategoryId(item.categoryId ?? undefined)}
            last={index === categories.length - 1}
          />
        ))}
      </Card>

      <SectionHeader title="Account" />
      <Card padding="none">
        <ListRow
          label="Any account"
          chevron={false}
          trailing={accountId === undefined ? <Selected /> : undefined}
          onPress={() => setAccountId(undefined)}
          last={accounts.length === 0}
        />
        {accounts.map((item, index) => (
          <ListRow
            key={item.accountId}
            label={getTransactionAccountLabel(item)}
            chevron={false}
            trailing={accountId === item.accountId ? <Selected /> : undefined}
            onPress={() => setAccountId(item.accountId ?? undefined)}
            last={index === accounts.length - 1}
          />
        ))}
      </Card>
    </BottomSheet>
  );
}

/** The chosen option in a picker list. A tick in the accent, never a filled row. */
function Selected() {
  return (
    <Text variant="smallStrong" tone="accent">
      Selected
    </Text>
  );
}

function TransactionsSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View>
      <Skeleton width={190} height={30} radius="pill" style={{ marginTop: space.xs }} />
      <Skeleton height={size.touchTarget} radius={radius.control} style={{ marginTop: space.lg }} />
      <View style={[styles.chips, { marginTop: space.md + 2, gap: space.sm }]}>
        <Skeleton width={64} height={size.chip} radius="pill" />
        <Skeleton width={92} height={size.chip} radius="pill" />
        <Skeleton width={84} height={size.chip} radius="pill" />
      </View>
      {[0, 1].map((group) => (
        <View key={group} style={{ marginTop: space.xxl - 2 }}>
          <Skeleton width={86} height={12} radius="pill" style={{ marginBottom: space.md }} />
          <Skeleton height={size.transactionRow * 3} radius={radius.card} />
        </View>
      ))}
    </View>
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => number | null) {
  const seen = new Set<number | null>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  dayTotal: { opacity: 0.9 },
});
