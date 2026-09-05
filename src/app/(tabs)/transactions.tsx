import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppButton, AppText, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import {
  formatTransactionDateSection,
  getTransactionAccountLabel,
  getTransactionLabel,
} from '@/features/transactions/transaction-presentation';
import { TransactionListRow } from '@/features/transactions/TransactionListRow';
import { filterTransactionViews } from '@/features/transactions/transaction-list-filter';
import type { TransactionView } from '@/features/transactions/transaction.types';
import { isLocalFinanceDataAvailable, listTransactionViews } from '@/features/ui/data';

type TypeFilter = 'all' | 'expense' | 'income';
type DateFilter = 'all' | 'today' | 'week' | 'month';

export default function TransactionsScreen() {
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

  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (loading)
    return (
      <Screen>
        <ScreenState
          title="Loading transactions"
          description="Reading your local transaction history..."
        />
      </Screen>
    );
  if (failed)
    return (
      <Screen>
        <ScreenState
          title="Could not load transactions"
          description="Your local transaction history could not be read."
          retry={load}
        />
      </Screen>
    );

  const visible = filterTransactionViews(transactions, {
    search,
    type,
    date,
    categoryId,
    accountId,
  });
  const categoryCandidates =
    type === 'all' ? transactions : transactions.filter((item) => item.type === type);
  const categories = uniqueBy(categoryCandidates, (item) => item.categoryId).filter(
    (item) => item.categoryId !== null,
  );
  const accounts = uniqueBy(transactions, (item) => item.accountId).filter(
    (item) => item.accountId !== null,
  );
  const filtersActive =
    type !== 'all' || date !== 'all' || categoryId !== undefined || accountId !== undefined;

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Transactions
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter transactions"
          onPress={() => setShowFilters(true)}
        >
          <AppText color={colors.primary} weight="600">
            Filter
          </AppText>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Search transactions"
        onChangeText={setSearch}
        placeholder="Search transactions..."
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        value={search}
      />
      <View style={styles.typeFilters}>
        <FilterChip label="All" selected={type === 'all'} onPress={() => setType('all')} />
        <FilterChip
          label="Expense"
          selected={type === 'expense'}
          onPress={() => setType('expense')}
        />
        <FilterChip label="Income" selected={type === 'income'} onPress={() => setType('income')} />
      </View>
      {filtersActive ? (
        <AppButton label="Clear Filters" variant="secondary" onPress={clearFilters} />
      ) : null}

      {transactions.length === 0 ? (
        <>
          <ScreenState
            title="No transactions yet."
            description="Tap + to add your first expense or income."
          />
          <AppButton label="Quick Add" onPress={() => router.navigate('/add' as never)} />
        </>
      ) : visible.length === 0 ? (
        <>
          <ScreenState
            title="No transactions found."
            description="Try a different search or clear your filters."
          />
          {filtersActive ? <AppButton label="Clear Filters" onPress={clearFilters} /> : null}
        </>
      ) : (
        <View style={styles.list}>
          {visible.map((transaction, index) => {
            const previous = visible[index - 1];
            const showHeading =
              !previous ||
              formatTransactionDateSection(previous.transactionDate) !==
                formatTransactionDateSection(transaction.transactionDate);
            return (
              <View key={transaction.id} style={styles.itemWrap}>
                {showHeading ? (
                  <AppText weight="700" color={colors.textMuted}>
                    {formatTransactionDateSection(transaction.transactionDate)}
                  </AppText>
                ) : null}
                <TransactionListRow transaction={transaction} />
              </View>
            );
          })}
        </View>
      )}

      <Modal
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}
        transparent
        visible={showFilters}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <AppText variant="heading" weight="700">
                Filters
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                onPress={() => setShowFilters(false)}
              >
                <AppText color={colors.primary} weight="600">
                  Done
                </AppText>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <AppText weight="600">Date</AppText>
              <View style={styles.filterOptions}>
                <FilterChip
                  label="All Time"
                  selected={date === 'all'}
                  onPress={() => setDate('all')}
                />
                <FilterChip
                  label="Today"
                  selected={date === 'today'}
                  onPress={() => setDate('today')}
                />
                <FilterChip
                  label="This Week"
                  selected={date === 'week'}
                  onPress={() => setDate('week')}
                />
                <FilterChip
                  label="This Month"
                  selected={date === 'month'}
                  onPress={() => setDate('month')}
                />
              </View>
              <AppText weight="600">Category</AppText>
              <FilterOption
                label="Any category"
                selected={categoryId === undefined}
                onPress={() => setCategoryId(undefined)}
              />
              {categories.map((item) => (
                <FilterOption
                  key={item.categoryId}
                  label={getTransactionLabel(item)}
                  selected={categoryId === item.categoryId}
                  onPress={() => setCategoryId(item.categoryId ?? undefined)}
                />
              ))}
              <AppText weight="600">Account</AppText>
              <FilterOption
                label="Any account"
                selected={accountId === undefined}
                onPress={() => setAccountId(undefined)}
              />
              {accounts.map((item) => (
                <FilterOption
                  key={item.accountId}
                  label={getTransactionAccountLabel(item)}
                  selected={accountId === item.accountId}
                  onPress={() => setAccountId(item.accountId ?? undefined)}
                />
              ))}
              <AppButton label="Clear Filters" variant="secondary" onPress={clearFilters} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );

  function clearFilters() {
    setType('all');
    setDate('all');
    setCategoryId(undefined);
    setAccountId(undefined);
  }
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <AppText weight="600" color={selected ? colors.surface : colors.textMuted}>
        {label}
      </AppText>
    </Pressable>
  );
}

function FilterOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.option}
    >
      <AppText weight={selected ? '700' : '400'}>{label}</AppText>
      {selected ? <AppText color={colors.primary}>Selected</AppText> : null}
    </Pressable>
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => number | null) {
  return items.filter(
    (item, index) => items.findIndex((candidate) => key(candidate) === key(item)) === index,
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
  },
  typeFilters: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.primary },
  list: { gap: spacing.md },
  itemWrap: { gap: spacing.sm },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.32)' },
  modal: {
    maxHeight: '80%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  modalContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
