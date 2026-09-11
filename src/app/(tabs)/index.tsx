import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BalanceCard,
  Card,
  CategoryChip,
  DonutChart,
  type DonutSegment,
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  Money,
  NativeDataNotice,
  ProgressBar,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
  TransactionRow,
} from '@/components/ui';
import {
  categoryLabel,
  formatBudgetPercentage,
  getBudgetAccessibilityLabel,
  getBudgetProgressAccessibilityLabel,
  getBudgetRemainderLabel,
  getBudgetSpendLabel,
  isOverBudget,
} from '@/features/budgets/budget-presentation';
import type { BudgetProgress } from '@/features/budgets/budget.types';
import type { DashboardSummary, HomeBudgetSummary } from '@/features/dashboard/dashboard.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getAppSettings,
  getDashboardSummary,
  getHomeBudgetSummary,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
} from '@/features/ui/data';
import { getCategoryIdentity, useTheme } from '@/theme';
import { formatMinorUnits, splitMinorUnits } from '@/utils/money';

export default function HomeScreen() {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [budget, setBudget] = useState<HomeBudgetSummary>();
  const [currency, setCurrency] = useState('NPR');
  const [accountCount, setAccountCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setSummary(getDashboardSummary());
      // A planning figure, read from the budget engine rather than recomputed
      // here. Home has no second opinion about what was spent.
      setBudget(getHomeBudgetSummary());
      setCurrency(getAppSettings().defaultCurrency);
      setAccountCount(listActiveAccounts().length);
    } catch (error) {
      console.error('Could not load dashboard.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

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
        <HomeSkeleton />
      </Screen>
    );
  }
  if (failed || !summary) {
    return (
      <Screen tabBar>
        <ErrorState
          message="Something went wrong reading the local database. Your data is safe."
          onRetry={load}
        />
      </Screen>
    );
  }
  if (accountCount === 0) {
    return (
      <Screen tabBar>
        <EmptyState
          illustration="card"
          title="Start with an account"
          body="Add the account you keep money in. Income and expenses are recorded against it."
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll tabBar>
      <Header />
      <View style={styles.hero}>
        <BalanceCard
          minorUnits={summary.totalBalanceMinor}
          currency={currency}
          caption={accountCount === 1 ? 'Across 1 account' : 'Across ' + accountCount + ' accounts'}
        />
      </View>

      <MonthCard summary={summary} currency={currency} />

      {budget ? <BudgetSection budget={budget} /> : null}

      <View style={styles.section}>
        <SectionHeader
          title="Spending"
          action={{
            label: 'This month',
            onPress: () => router.navigate('/reports' as never),
            accessibilityLabel: 'Open reports for this month',
          }}
        />
        <SpendingCard summary={summary} currency={currency} />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Recent"
          action={
            summary.recentTransactions.length > 0
              ? {
                  label: 'View all',
                  onPress: () => router.navigate('/transactions' as never),
                  accessibilityLabel: 'View all transactions',
                }
              : undefined
          }
        />
        {summary.recentTransactions.length === 0 ? (
          <Card>
            <Text variant="body" tone="secondary">
              No transactions yet. Tap the plus button to record your first one.
            </Text>
          </Card>
        ) : (
          <Card padding="none">
            {summary.recentTransactions.map((transaction, index) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                last={index === summary.recentTransactions.length - 1}
                onPress={() => router.push(('/transaction/' + transaction.id) as never)}
              />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

function Header() {
  const { space } = useTheme();
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(now);
  return (
    <View style={{ gap: 2, marginTop: space.xs }}>
      <Text variant="body" tone="secondary">
        {getGreeting(now)}
      </Text>
      <Text variant="heading">{date}</Text>
    </View>
  );
}

/** Income, expense, and what was left, in one card divided by hairlines. */
function MonthCard({ summary, currency }: { summary: DashboardSummary; currency: string }) {
  const { palette, space, gutter } = useTheme();
  const overspent = summary.monthlySavingsMinor < 0;
  const rowStyle = { paddingVertical: space.md + 1, paddingHorizontal: gutter - 2 };
  return (
    <Card padding="none" style={styles.month}>
      <View style={[styles.monthRow, rowStyle]}>
        <View style={[styles.monthLabel, { gap: space.sm + 2 }]}>
          <Icon name="arrow-down-left" size={17} color={palette.positive} />
          <Text variant="body" tone="secondary">
            Income
          </Text>
        </View>
        <Money minorUnits={summary.monthlyIncomeMinor} currency={currency} direction="income" />
      </View>
      <View style={[styles.divider, { backgroundColor: palette.divider }]} />
      <View style={[styles.monthRow, rowStyle]}>
        <View style={[styles.monthLabel, { gap: space.sm + 2 }]}>
          <Icon name="arrow-up-right" size={17} color={palette.negative} />
          <Text variant="body" tone="secondary">
            Expense
          </Text>
        </View>
        <Money minorUnits={summary.monthlyExpenseMinor} currency={currency} direction="expense" />
      </View>
      <View style={[styles.divider, { backgroundColor: palette.hairline }]} />
      <View style={[styles.monthRow, rowStyle]}>
        <Text variant="bodyStrong">{overspent ? 'Overspent this month' : 'Saved this month'}</Text>
        <Money
          minorUnits={Math.abs(summary.monthlySavingsMinor)}
          currency={currency}
          direction={overspent ? 'expense' : 'neutral'}
        />
      </View>
    </Card>
  );
}

/**
 * This month's plan, as a glance rather than a dashboard.
 *
 * Home shows a plan only where the user set one. With an overall budget it says
 * "Monthly Budget" and shows that budget; with only category budgets it shows
 * those and never sums them into something called a monthly budget, because a
 * total the user never chose is not their budget. With nothing set it offers to
 * set one and takes up a single row.
 *
 * Every figure comes from the budget summary the dashboard service composed.
 * Nothing here adds up a transaction.
 */
function BudgetSection({ budget }: { budget: HomeBudgetSummary }) {
  const { space } = useTheme();

  if (!budget.hasAnyBudget) {
    return (
      <View style={styles.section}>
        <Card padding="none">
          <ListRow
            icon="target"
            label="Set a monthly budget"
            detail="Compare what you planned with what you spent."
            onPress={() => router.push('/budgets' as never)}
            last
          />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader
        title={budget.overall ? 'Monthly Budget' : 'Budgets'}
        action={{
          label: 'View all',
          onPress: () => router.push('/budgets' as never),
          accessibilityLabel: 'View budgets',
        }}
      />
      <Card style={{ gap: space.md }}>
        {budget.overall ? <OverallSummary progress={budget.overall} /> : null}
        {budget.highlights.length > 0 ? (
          <View style={{ gap: space.sm + 2 }}>
            {budget.highlights.map((progress) => (
              <BudgetHighlight key={progress.budget.id} progress={progress} />
            ))}
          </View>
        ) : null}
        {budget.categoryBudgetCount > budget.highlights.length ? (
          <Text variant="caption" tone="tertiary">
            {'and ' +
              (budget.categoryBudgetCount - budget.highlights.length) +
              ' more category ' +
              (budget.categoryBudgetCount - budget.highlights.length === 1 ? 'budget' : 'budgets')}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

/** The overall plan: what has gone, what is left, and the bar between them. */
function OverallSummary({ progress }: { progress: BudgetProgress }) {
  const { space } = useTheme();
  const over = isOverBudget(progress);
  return (
    <View
      accessible
      accessibilityLabel={getBudgetAccessibilityLabel(progress)}
      style={{ gap: space.sm }}
    >
      <Text variant="body" tone="secondary" tabular>
        {getBudgetSpendLabel(progress, { code: false }) + ' spent'}
      </Text>
      <Text variant="bodyStrong" tone={over ? 'negative' : 'primary'} tabular>
        {getBudgetRemainderLabel(progress, { code: false })}
      </Text>
      <ProgressBar
        value={progress.spentMinor}
        max={progress.budget.amountMinor}
        accessibilityValueText={getBudgetProgressAccessibilityLabel(progress)}
      />
    </View>
  );
}

/** One category worth a glance: what it is, where it stands, and by how much. */
function BudgetHighlight({ progress }: { progress: BudgetProgress }) {
  const { space } = useTheme();
  const over = isOverBudget(progress);
  return (
    <View
      accessible
      accessibilityLabel={getBudgetAccessibilityLabel(progress)}
      style={[styles.highlight, { gap: space.sm }]}
    >
      <CategoryChip categoryIcon={progress.categoryIcon} size={24} />
      <Text variant="small" numberOfLines={1} style={styles.highlightName}>
        {categoryLabel(progress)}
      </Text>
      <Text variant="caption" tone={over ? 'negative' : 'tertiary'} tabular>
        {over ? 'Over budget' : getBudgetRemainderLabel(progress, { code: false })}
      </Text>
      <Text variant="captionStrong" tabular tone={over ? 'negative' : 'secondary'}>
        {formatBudgetPercentage(progress.percentage)}
      </Text>
    </View>
  );
}

/** The month's category split: a donut with the total in its centre and a legend. */
function SpendingCard({ summary, currency }: { summary: DashboardSummary; currency: string }) {
  const { space } = useTheme();
  const categories = summary.categorySpending;

  if (categories.length === 0) {
    return (
      <Card>
        <Text variant="body" tone="secondary">
          No spending recorded this month.
        </Text>
      </Card>
    );
  }

  const segments: DonutSegment[] = categories.map((category) => ({
    key: category.categoryId,
    value: category.amountMinor,
    color: getCategoryIdentity(category.categoryIcon).hue,
  }));
  const shownTotal = categories.reduce((sum, c) => sum + c.amountMinor, 0);
  const remainder = summary.monthlyExpenseMinor - shownTotal;
  if (remainder > 0) {
    segments.push({ key: 'other', value: remainder, color: getCategoryIdentity('other').hue });
  }

  return (
    <Card padding="lg" style={[styles.spending, { gap: space.lg + 2 }]}>
      <DonutChart
        segments={segments}
        accessibilityLabel={
          'Spending this month ' + formatMinorUnits(summary.monthlyExpenseMinor, currency)
        }
      >
        <Text variant="tab" tone="tertiary" style={styles.donutCaption}>
          Total
        </Text>
        <Text variant="bodyStrong" tabular>
          {splitMinorUnits(summary.monthlyExpenseMinor, currency).integer}
        </Text>
      </DonutChart>
      <View style={[styles.legend, { gap: space.sm + 1 }]}>
        {categories.map((category) => (
          <View
            key={category.categoryId}
            accessible
            accessibilityLabel={
              category.categoryName +
              ', ' +
              formatMinorUnits(category.amountMinor, currency) +
              ', ' +
              category.percentage +
              '% of spending'
            }
            style={[styles.legendRow, { gap: space.sm }]}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: getCategoryIdentity(category.categoryIcon).hue },
              ]}
            />
            <Text variant="small" tone="secondary" numberOfLines={1} style={styles.legendLabel}>
              {category.categoryName}
            </Text>
            <Text variant="smallStrong" tabular>
              {splitMinorUnits(category.amountMinor, currency).integer}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function HomeSkeleton() {
  const { space, radius } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.sm, marginTop: space.xs, marginBottom: space.sm }}>
        <Skeleton width={110} height={14} radius="pill" />
        <Skeleton width={180} height={22} radius="pill" />
      </View>
      <Skeleton height={150} radius={radius.heroCard} />
      <Skeleton height={148} radius={radius.card} />
      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Skeleton width={90} height={12} radius="pill" />
        <Skeleton height={140} radius={radius.card} />
      </View>
      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Skeleton width={70} height={12} radius="pill" />
        <Skeleton height={68 * 3} radius={radius.card} />
      </View>
    </View>
  );
}

function getGreeting(now: Date) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  hero: { marginTop: 18 },
  month: { marginTop: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  section: { marginTop: 24 },
  spending: { flexDirection: 'row', alignItems: 'center' },
  donutCaption: { marginBottom: 1 },
  legend: { flex: 1 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendLabel: { flex: 1 },
  highlight: { flexDirection: 'row', alignItems: 'center' },
  highlightName: { flex: 1, minWidth: 0 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
});
