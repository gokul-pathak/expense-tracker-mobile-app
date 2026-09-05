import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import type { DashboardSummary } from '@/features/dashboard/dashboard.types';
import { TransactionListRow } from '@/features/transactions/TransactionListRow';
import {
  getAppSettings,
  getDashboardSummary,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
} from '@/features/ui/data';
import { formatMinorUnits } from '@/utils/money';

export default function HomeScreen() {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [currency, setCurrency] = useState('NPR');
  const [hasAccounts, setHasAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setSummary(getDashboardSummary());
      setCurrency(getAppSettings().defaultCurrency);
      setHasAccounts(listActiveAccounts().length > 0);
    } catch (error) {
      console.error('Could not load dashboard.', error);
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
          title="Loading your summary"
          description="Reading your financial overview..."
        />
      </Screen>
    );
  if (failed || !summary)
    return (
      <Screen>
        <ScreenState
          title="Could not load your financial summary"
          description="Your local financial data could not be read."
          retry={load}
        />
      </Screen>
    );
  if (!hasAccounts)
    return (
      <Screen>
        <ScreenState
          title="Start tracking your money"
          description="Add an account to begin recording income and expenses."
        />
        <AppButton label="Add Account" onPress={() => router.push('/accounts/new' as never)} />
      </Screen>
    );

  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="heading" weight="700">
        {getGreeting()}
      </AppText>

      <Card
        style={styles.balanceCard}
        accessible
        accessibilityLabel={`Total balance ${formatMinorUnits(summary.totalBalanceMinor, currency)}`}
      >
        <AppText color={colors.textMuted} weight="600">
          Total Balance
        </AppText>
        <AppText variant="title" weight="700" style={styles.balanceAmount}>
          {formatMinorUnits(summary.totalBalanceMinor, currency)}
        </AppText>
      </Card>

      <View style={styles.section}>
        <AppText variant="subheading" weight="700">
          This Month
        </AppText>
        <Card style={styles.monthlyCard}>
          <Metric
            label="Income"
            value={summary.monthlyIncomeMinor}
            currency={currency}
            color={colors.success}
          />
          <Metric
            label="Expense"
            value={summary.monthlyExpenseMinor}
            currency={currency}
            color={colors.danger}
          />
          <View style={styles.savings}>
            <Metric label="Saved" value={summary.monthlySavingsMinor} currency={currency} />
            {summary.monthlySavingsMinor < 0 ? (
              <AppText variant="caption" color={colors.textMuted}>
                Spent more than earned
              </AppText>
            ) : null}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="subheading" weight="700">
          Spending
        </AppText>
        {summary.categorySpending.length === 0 ? (
          <Card>
            <AppText color={colors.textMuted}>No spending recorded this month.</AppText>
          </Card>
        ) : (
          <Card style={styles.categories}>
            {summary.categorySpending.map((category) => (
              <View
                key={category.categoryId}
                accessible
                accessibilityLabel={`${category.categoryName}, ${formatMinorUnits(category.amountMinor, currency)}, ${category.percentage}% of spending`}
                style={styles.category}
              >
                <View style={styles.categoryHeader}>
                  <View>
                    <AppText weight="600">{category.categoryName}</AppText>
                    <AppText variant="caption" color={colors.textMuted}>
                      {formatMinorUnits(category.amountMinor, currency)}
                    </AppText>
                  </View>
                  <AppText weight="700">{category.percentage}%</AppText>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${category.percentage}%` }]} />
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="subheading" weight="700">
            Recent Transactions
          </AppText>
          {summary.recentTransactions.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View all transactions"
              onPress={() => router.navigate('/transactions' as never)}
            >
              <AppText color={colors.primary} weight="600">
                View All
              </AppText>
            </Pressable>
          ) : null}
        </View>
        {summary.recentTransactions.length === 0 ? (
          <Card>
            <AppText color={colors.textMuted}>
              No transactions yet. Tap + to add your first expense or income.
            </AppText>
          </Card>
        ) : (
          <View style={styles.transactions}>
            {summary.recentTransactions.map((transaction) => (
              <TransactionListRow key={transaction.id} transaction={transaction} />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

function Metric({
  label,
  value,
  currency,
  color,
}: {
  label: string;
  value: number;
  currency: string;
  color?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${formatMinorUnits(value, currency)}`}
      style={styles.metric}
    >
      <AppText variant="caption" color={colors.textMuted} weight="600">
        {label}
      </AppText>
      <AppText weight="700" color={color}>
        {formatMinorUnits(value, currency)}
      </AppText>
    </View>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  balanceCard: { gap: spacing.xs, paddingVertical: spacing.xl },
  balanceAmount: { fontSize: 34 },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthlyCard: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metric: { flexGrow: 1, gap: spacing.xs },
  savings: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: spacing.md,
  },
  categories: { gap: spacing.lg },
  category: { gap: spacing.sm },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barTrack: {
    height: 7,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  barFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  transactions: { gap: spacing.sm },
});
