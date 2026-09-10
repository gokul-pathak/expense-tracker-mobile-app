import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  CategoryChip,
  DonutChart,
  EmptyState,
  ErrorState,
  FormScreen,
  Icon,
  Money,
  NativeDataNotice,
  ProgressBar,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { formatPeriodMonth, type PeriodMonth } from '@/features/budgets/budget.period';
import type { BudgetProgress, MonthlyBudgetSummary } from '@/features/budgets/budget.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getMonthlyBudgetSummary,
  isLocalFinanceDataAvailable,
  listCategories,
} from '@/features/ui/data';
import { getCategoryIdentity, useTheme } from '@/theme';
import { splitMinorUnits } from '@/utils/money';

export default function BudgetsScreen() {
  const { space, radius } = useTheme();
  const [month, setMonth] = useState<PeriodMonth>(() => formatPeriodMonth(new Date()));
  const [summary, setSummary] = useState<MonthlyBudgetSummary>();
  // A budget carries its category's id and current name but not its icon, so
  // the identity is looked up once per load rather than per row.
  const [icons, setIcons] = useState<Map<number, string | null>>(new Map());
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setSummary(getMonthlyBudgetSummary(month));
      setIcons(new Map(listCategories().map((category) => [category.id, category.icon])));
    } catch (error) {
      console.error('Could not load budgets.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  const hasAnything =
    summary !== undefined && (summary.overallBudget !== null || summary.categoryBudgets.length > 0);

  return (
    <FormScreen
      title="Budgets"
      footer={
        hasAnything ? (
          <Button
            label="Set a Budget"
            variant="text"
            icon="plus"
            fullWidth
            onPress={() => router.push(`/budgets/new?month=${month}` as never)}
          />
        ) : undefined
      }
    >
      <MonthStepper month={month} onChange={setMonth} />

      {loading ? (
        <View style={{ marginTop: space.lg }}>
          <Skeleton height={154} radius={radius.heroCard} />
          <Skeleton height={200} radius={radius.card} style={{ marginTop: space.xxl }} />
        </View>
      ) : failed || !summary ? (
        <ErrorState
          message="Your budgets could not be read from local data. Your data is safe."
          onRetry={load}
        />
      ) : !hasAnything ? (
        <EmptyState
          illustration="arcs"
          title="No budget for this month"
          body="A budget is a limit you set for the month, overall or per category. Nothing is carried over from last month automatically."
          action={{
            label: 'Set a Budget',
            onPress: () => router.push(`/budgets/new?month=${month}` as never),
          }}
        />
      ) : (
        <>
          {summary.overallBudget ? (
            <OverallCard progress={summary.overallBudget} month={month} />
          ) : (
            <Card style={{ marginTop: space.lg }}>
              <Text variant="body" tone="secondary">
                No overall limit for this month. The categories below are budgeted on their own.
              </Text>
              <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
                <Button
                  label="Set an overall budget"
                  variant="text"
                  onPress={() => router.push(`/budgets/new?month=${month}` as never)}
                />
              </View>
            </Card>
          )}

          <View style={{ marginTop: space.xxl }}>
            <SectionHeader title="By category" />
            {summary.categoryBudgets.length === 0 ? (
              <Card>
                <Text variant="body" tone="secondary">
                  No category budgets this month.
                </Text>
              </Card>
            ) : (
              <Card>
                <View style={{ gap: space.xl }}>
                  {summary.categoryBudgets.map((progress) => (
                    <CategoryBudgetRow
                      key={progress.budget.id}
                      progress={progress}
                      categoryIcon={
                        progress.budget.categoryId === null
                          ? null
                          : (icons.get(progress.budget.categoryId) ?? null)
                      }
                    />
                  ))}
                </View>
              </Card>
            )}
          </View>

          <Text variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
            Budgets are set per currency and never converted. This month is in {summary.currency}.
          </Text>
        </>
      )}
    </FormScreen>
  );
}

/** A month at a time, because a budget is a monthly promise and nothing else. */
function MonthStepper({
  month,
  onChange,
}: {
  month: PeriodMonth;
  onChange: (next: PeriodMonth) => void;
}) {
  const { palette, space, size } = useTheme();
  const step = (delta: number) => {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7)) - 1;
    onChange(formatPeriodMonth(new Date(year, index + delta, 1)));
  };

  return (
    <View style={[styles.stepper, { marginTop: space.sm }]}>
      <Arrow icon="chevron-left" label="Previous month" onPress={() => step(-1)} />
      <Text variant="subheading">{monthLabel(month)}</Text>
      <Arrow icon="chevron-right" label="Next month" onPress={() => step(1)} />
    </View>
  );

  function Arrow({
    icon,
    label,
    onPress,
  }: {
    icon: 'chevron-left' | 'chevron-right';
    label: string;
    onPress: () => void;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={10}
        onPress={onPress}
        style={({ pressed }) => [
          styles.arrow,
          { width: size.touchTarget, height: size.touchTarget },
          pressed && styles.pressed,
        ]}
      >
        <Icon name={icon} size="row" color={palette.textSecondary} />
      </Pressable>
    );
  }
}

/**
 * The ring reads as "how much of the month's promise is gone". Past 100% it
 * fills entirely in `negative` rather than wrapping — a ring that laps itself
 * reads as being back near the start, which is the opposite of the truth.
 */
function OverallCard({ progress, month }: { progress: BudgetProgress; month: PeriodMonth }) {
  const { palette, space } = useTheme();
  const currency = progress.budget.currency;
  const over = progress.status === 'over_budget';
  const used = Math.min(progress.percentage, 100);

  return (
    <Card hero style={[styles.overall, { marginTop: space.lg, gap: space.xl }]}>
      <DonutChart
        size={110}
        strokeWidth={10}
        segments={
          over
            ? [{ key: 'over', value: 1, color: palette.negative }]
            : [
                { key: 'used', value: Math.max(used, 0.01), color: palette.accent },
                { key: 'left', value: Math.max(100 - used, 0.01), color: 'transparent' },
              ]
        }
        accessibilityLabel={Math.round(progress.percentage) + ' percent of this month used'}
      >
        <Text variant="heading" tabular>
          {Math.round(progress.percentage)}%
        </Text>
        <Text variant="tab" tone="tertiary">
          used
        </Text>
      </DonutChart>

      <View style={styles.overallText}>
        <Text variant="eyebrow" tone="tertiary">
          Monthly budget
        </Text>
        <View style={[styles.spend, { marginTop: space.sm }]}>
          <Text variant="heading" tabular tone={over ? 'negative' : 'primary'}>
            {splitMinorUnits(progress.spentMinor, currency).integer}
          </Text>
          <Text variant="small" tone="tertiary" tabular>
            {' / ' + splitMinorUnits(progress.budget.amountMinor, currency).integer}
          </Text>
        </View>
        <Text variant="small" tone="secondary" style={{ marginTop: space.xs + 2 }}>
          {remainderLine(progress, month)}
        </Text>
      </View>
    </Card>
  );
}

function CategoryBudgetRow({
  progress,
  categoryIcon,
}: {
  progress: BudgetProgress;
  categoryIcon: string | null;
}) {
  const { space } = useTheme();
  const currency = progress.budget.currency;
  const hue = getCategoryIdentity(categoryIcon).hue;
  const over = progress.status === 'over_budget';

  return (
    <View
      accessible
      accessibilityLabel={
        (progress.categoryName ?? 'Category') +
        ', ' +
        Math.round(progress.percentage) +
        ' percent of budget used'
      }
      style={{ gap: space.sm }}
    >
      <View style={[styles.categoryHead, { gap: space.md }]}>
        <CategoryChip categoryIcon={categoryIcon} size={32} />
        <View style={styles.categoryText}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {progress.categoryName ?? 'Uncategorised'}
          </Text>
          <Text variant="caption" tone="tertiary" tabular>
            {progress.spentMinor === 0
              ? 'Nothing spent yet'
              : splitMinorUnits(progress.spentMinor, currency).integer +
                ' / ' +
                splitMinorUnits(progress.budget.amountMinor, currency).integer}
          </Text>
        </View>
      </View>
      <ProgressBar value={progress.spentMinor} max={progress.budget.amountMinor} color={hue} />
      {over ? (
        <View style={styles.over}>
          <Text variant="caption" tone="negative">
            Over by{' '}
          </Text>
          <Money
            minorUnits={progress.overspentMinor}
            currency={currency}
            size="row"
            showCode={false}
            muted
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * States the remainder and how long it has to last. Never advice — the app
 * reports the gap and the days, and says nothing about what to do with them.
 */
function remainderLine(progress: BudgetProgress, month: PeriodMonth) {
  const currency = progress.budget.currency;
  const days = daysLeftIn(month);
  const dayText = days === null ? '' : ' · ' + days + (days === 1 ? ' day' : ' days');
  if (progress.status === 'over_budget') {
    return (
      currency +
      ' ' +
      splitMinorUnits(progress.overspentMinor, currency).integer +
      ' over' +
      dayText
    );
  }
  return (
    currency + ' ' + splitMinorUnits(progress.remainingMinor, currency).integer + ' left' + dayText
  );
}

/** Null for a month that is not the current one, where "days left" means nothing. */
function daysLeftIn(month: PeriodMonth): number | null {
  const now = new Date();
  if (formatPeriodMonth(now) !== month) return null;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(Math.ceil((end.getTime() - now.getTime()) / 86_400_000), 0);
}

function monthLabel(month: PeriodMonth) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, index, 1),
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  overall: { flexDirection: 'row', alignItems: 'center' },
  overallText: { flex: 1, minWidth: 0 },
  spend: { flexDirection: 'row', alignItems: 'baseline' },
  categoryHead: { flexDirection: 'row', alignItems: 'center' },
  categoryText: { flex: 1, minWidth: 0, gap: 1 },
  over: { flexDirection: 'row', alignItems: 'baseline' },
});
