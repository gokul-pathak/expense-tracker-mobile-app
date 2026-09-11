import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  NativeDataNotice,
  NavBar,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { BudgetRow } from '@/features/budgets/BudgetRow';
import { MonthStepper } from '@/features/budgets/MonthStepper';
import { OverallBudgetCard } from '@/features/budgets/OverallBudgetCard';
import {
  currentPeriodMonth,
  getShortMonthLabel,
  sortBudgetProgress,
} from '@/features/budgets/budget-presentation';
import type { PeriodMonth } from '@/features/budgets/budget.period';
import type { BudgetProgress, MonthlyBudgetSummary } from '@/features/budgets/budget.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getMonthlyBudgetSummary,
  isLocalFinanceDataAvailable,
  listBudgetsForMonth,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { splitMinorUnits } from '@/utils/money';

type Loaded = {
  month: PeriodMonth;
  summary: MonthlyBudgetSummary;
  categoryBudgets: BudgetProgress[];
  /**
   * Budgets this month holds in some other currency.
   *
   * A summary is always about one currency, because budgets are never converted.
   * Counting the rest is what stops a change of default currency reading as
   * every budget having been deleted.
   */
  otherCurrencyCount: number;
};

/**
 * A month's plan, one month at a time.
 *
 * The list is virtualized rather than a column inside a scroll view: the number
 * of category budgets a month can hold is the number of expense categories, and
 * that has no ceiling the app enforces.
 *
 * Everything on screen comes from one call to the budget engine. The screen
 * touches no SQL, computes no spending of its own, and stores none — spending is
 * summed from the transactions each time it is read, which is why an expense
 * recorded anywhere in the app shows up here without this screen being told.
 */
export default function BudgetsScreen() {
  const { palette, space, gutter, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState<PeriodMonth>(() => currentPeriodMonth());
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);
  /**
   * The month the newest read was started for. A sync landing while the user
   * steps to another month would otherwise finish last and paint figures from
   * the month they just left under the name of the one they are looking at.
   */
  const requested = useRef<PeriodMonth>(month);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    requested.current = month;
    setFailed(false);
    try {
      const summary = getMonthlyBudgetSummary(month);
      const otherCurrencyCount = listBudgetsForMonth(month).filter(
        (existing) => existing.currency !== summary.currency,
      ).length;
      if (requested.current !== month) return;
      setLoaded({
        month,
        summary,
        categoryBudgets: sortBudgetProgress(summary.categoryBudgets),
        otherCurrencyCount,
      });
    } catch (error) {
      // A budget whose spending cannot be read is never drawn as zero spent. A
      // confident wrong figure about someone's money is worse than saying so.
      console.error('Could not load budgets.', error);
      if (requested.current !== month) return;
      setLoaded(undefined);
      setFailed(true);
    }
  }, [month]);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  const addBudget = (type?: 'overall' | 'category') =>
    router.push(('/budgets/new?month=' + month + (type ? '&type=' + type : '')) as never);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  // Only figures belonging to the month on screen are ever rendered. Until the
  // newly chosen month has been read, the screen waits rather than showing the
  // previous month's numbers under the new month's name.
  const current = loaded?.month === month ? loaded : undefined;

  if (failed) {
    return (
      <Chrome month={month} onMonthChange={setMonth}>
        <ErrorState message="We couldn't load your budgets. Your data is safe." onRetry={load} />
      </Chrome>
    );
  }

  if (current === undefined) {
    return (
      <Chrome month={month} onMonthChange={setMonth}>
        <Skeleton height={154} radius={radius.heroCard} style={{ marginTop: space.lg }} />
        <Skeleton height={200} radius={radius.card} style={{ marginTop: space.xxl }} />
      </Chrome>
    );
  }

  const { summary, categoryBudgets, otherCurrencyCount } = current;
  const overall = summary.overallBudget;
  const hasAnything = overall !== null || categoryBudgets.length > 0;

  const header = (
    <View>
      <MonthStepper month={month} onChange={setMonth} />
      {overall !== null ? (
        <View style={{ marginTop: space.lg }}>
          <OverallBudgetCard
            progress={overall}
            onPress={() => router.push(('/budgets/' + overall.budget.id) as never)}
          />
        </View>
      ) : hasAnything ? (
        <Card style={{ marginTop: space.lg }}>
          <Text variant="body" tone="secondary">
            {'No overall budget set for ' + getShortMonthLabel(month) + '.'}
          </Text>
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
            The categories below are budgeted on their own.
          </Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button
              label="Set Overall Budget"
              variant="text"
              onPress={() => addBudget('overall')}
            />
          </View>
        </Card>
      ) : null}
      {hasAnything ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="By category" />
          {categoryBudgets.length === 0 ? (
            <Card>
              <Text variant="body" tone="secondary">
                No category budgets this month.
              </Text>
            </Card>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const otherCurrencyNote =
    otherCurrencyCount === 0
      ? null
      : otherCurrencyCount +
        (otherCurrencyCount === 1
          ? ' budget in another currency is'
          : ' budgets in other currencies are') +
        ' not shown here. Budgets are never converted, so each currency is read on its own.';

  const footer =
    !hasAnything && otherCurrencyNote === null ? null : (
      <View style={{ marginTop: space.lg, gap: space.xs }}>
        {hasAnything && categoryBudgets.length > 0 ? (
          <Text variant="caption" tone="tertiary" tabular>
            {'Category budgets total ' +
              splitMinorUnits(summary.categoryBudgetedMinor, summary.currency).integer +
              '. An overall budget is a limit of its own, never the sum of these.'}
          </Text>
        ) : null}
        {hasAnything ? (
          <Text variant="caption" tone="tertiary">
            {'Budgets are set per currency and never converted. This month is in ' +
              summary.currency +
              '.'}
          </Text>
        ) : null}
        {otherCurrencyNote === null ? null : (
          <Text variant="caption" tone="tertiary">
            {otherCurrencyNote}
          </Text>
        )}
      </View>
    );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Budgets" onBack={() => router.back()} />
      <FlatList
        data={categoryBudgets}
        keyExtractor={(item) => String(item.budget.id)}
        renderItem={({ item }) => (
          <BudgetRow
            progress={item}
            onPress={() => router.push(('/budgets/' + item.budget.id) as never)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.xl }} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          hasAnything ? null : (
            <EmptyState
              illustration="arcs"
              title={'No budgets for ' + getShortMonthLabel(month)}
              body="Create a budget to compare your planned and actual spending. Nothing is carried over from last month automatically."
              action={{ label: 'Add Budget', onPress: () => addBudget() }}
            />
          )
        }
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: space.sm,
          // The pinned Add Button carries the safe area when it is there. With
          // nothing pinned, the list has to clear the home indicator itself.
          paddingBottom: hasAnything ? space.xxl : insets.bottom + space.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
      {hasAnything ? (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.xl,
          }}
        >
          <Button
            label="Add Budget"
            variant="text"
            icon="plus"
            fullWidth
            onPress={() => addBudget()}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The month stepper stays put while the body below it loads, fails or fills.
 * Losing the control that changes the month inside the state it produced would
 * strand someone on a month they cannot leave.
 */
function Chrome({
  month,
  onMonthChange,
  children,
}: {
  month: PeriodMonth;
  onMonthChange: (next: PeriodMonth) => void;
  children: ReactNode;
}) {
  const { palette, gutter, space } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Budgets" onBack={() => router.back()} />
      <View style={{ flex: 1, paddingHorizontal: gutter, paddingTop: space.sm }}>
        <MonthStepper month={month} onChange={onMonthChange} />
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
