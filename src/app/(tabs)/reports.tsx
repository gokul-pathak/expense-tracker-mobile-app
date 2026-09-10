import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  AreaChart,
  BottomSheet,
  Button,
  Card,
  Chip,
  DonutChart,
  EmptyState,
  ErrorState,
  Icon,
  isIconName,
  LargeTitle,
  ListRow,
  Money,
  NativeDataNotice,
  ProgressBar,
  Screen,
  SectionHeader,
  Skeleton,
  StatTile,
  Text,
  type DonutSegment,
  type IconName,
} from '@/components/ui';
import type {
  CategoryBreakdownItem,
  ReportInsight,
  ReportPreset,
  ReportRange,
  ReportSummary,
  TrendPoint,
} from '@/features/reports/reports.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getAppSettings,
  getCustomRange,
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getRecommendedGranularity,
  getReportRange,
  getReportSummary,
  getSimpleInsights,
  isLocalFinanceDataAvailable,
} from '@/features/ui/data';
import { getCategoryIdentity, useTheme } from '@/theme';
import { formatMinorUnits, splitMinorUnits } from '@/utils/money';

type ReportData = {
  summary: ReportSummary;
  categories: CategoryBreakdownItem[];
  trend: TrendPoint[];
  insights: ReportInsight[];
};

type PresetOption = { value: Exclude<ReportPreset, 'last_1_month'>; label: string };

const presets: PresetOption[] = [
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: '3 Months' },
  { value: 'last_6_months', label: '6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom' },
];

export default function ReportsScreen() {
  const { palette, space } = useTheme();
  const [preset, setPreset] = useState<ReportPreset>('this_month');
  const [range, setRange] = useState<ReportRange>(() => getReportRange('this_month'));
  const [data, setData] = useState<ReportData>();
  const [currency, setCurrency] = useState('NPR');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [customEnd, setCustomEnd] = useState(() => new Date());
  const [datePicker, setDatePicker] = useState<'start' | 'end'>();
  const [customError, setCustomError] = useState<string>();

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setData({
        summary: getReportSummary(range),
        categories: getExpenseCategoryBreakdown(range),
        trend: getIncomeExpenseTrend(range, getRecommendedGranularity(preset)),
        insights: getSimpleInsights(range),
      });
      setCurrency(getAppSettings().defaultCurrency);
    } catch (error) {
      console.error('Could not load report.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [preset, range]);
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
        <ReportsSkeleton />
      </Screen>
    );
  }
  if (failed || !data) {
    return (
      <Screen tabBar>
        <ErrorState
          message="This report could not be built from your local data. Your data is safe."
          onRetry={load}
        />
      </Screen>
    );
  }

  const empty = data.summary.incomeMinor === 0 && data.summary.expenseMinor === 0;

  return (
    <Screen scroll tabBar>
      <LargeTitle title="Reports" />
      <View style={{ marginTop: space.md }}>
        <PeriodPill label={rangeLabel(preset, range)} onPress={() => setShowPresets(true)} />
      </View>

      <Card style={[styles.summary, { marginTop: space.lg }]}>
        <StatTile
          label="Income"
          minorUnits={data.summary.incomeMinor}
          currency={currency}
          direction="income"
          size="row"
        />
        <StatTile
          label="Expense"
          minorUnits={data.summary.expenseMinor}
          currency={currency}
          direction="expense"
          size="row"
        />
        <StatTile
          label="Savings"
          minorUnits={data.summary.savingsMinor}
          currency={currency}
          size="row"
          align="right"
        />
      </Card>

      {empty ? (
        <EmptyState
          illustration="arcs"
          title="Nothing in this period"
          body="No income or expenses were recorded between these dates. Choose a wider period to see more."
          action={{ label: 'Change Period', onPress: () => setShowPresets(true) }}
        />
      ) : (
        <>
          <View style={{ marginTop: space.xxl }}>
            <SectionHeader title="Income vs Expense" />
            <Card>
              {data.trend.length === 0 ? (
                <Text variant="body" tone="secondary">
                  This period is too short to plot a trend.
                </Text>
              ) : (
                <AreaChart
                  labels={data.trend.map((point) => point.label)}
                  series={[
                    {
                      key: 'income',
                      label: 'Income',
                      color: palette.positive,
                      values: data.trend.map((point) => point.incomeMinor),
                    },
                    {
                      key: 'expense',
                      label: 'Expense',
                      color: palette.negative,
                      values: data.trend.map((point) => point.expenseMinor),
                    },
                  ]}
                  formatValue={(value) => splitMinorUnits(value, currency).integer}
                  accessibilityLabel={
                    'Income against expense over ' + data.trend.length + ' periods. Touch to scrub.'
                  }
                />
              )}
            </Card>
          </View>

          <View style={{ marginTop: space.xxl }}>
            <SectionHeader title="Spending by Category" />
            <CategoryCard
              categories={data.categories}
              totalMinor={data.summary.expenseMinor}
              currency={currency}
            />
          </View>

          {data.insights.length > 0 ? (
            <View style={{ marginTop: space.xxl }}>
              <SectionHeader title="Insights" />
              <Card padding="none">
                {data.insights.map((insight, index) => {
                  const presentation = presentInsight(insight, currency, data.categories);
                  return (
                    <ListRow
                      key={insight.type + '-' + index}
                      icon={presentation.icon}
                      iconColor={
                        presentation.tone === 'negative'
                          ? palette.negative
                          : presentation.tone === 'positive'
                            ? palette.positive
                            : palette.textSecondary
                      }
                      label={presentation.text}
                      chevron={false}
                      last={index === data.insights.length - 1}
                    />
                  );
                })}
              </Card>
            </View>
          ) : null}
        </>
      )}

      <BottomSheet
        visible={showPresets}
        onClose={() => setShowPresets(false)}
        title="Report period"
      >
        <View style={[styles.presets, { gap: space.sm }]}>
          {presets.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={preset === option.value}
              onPress={() => {
                setShowPresets(false);
                if (option.value === 'custom') {
                  setShowCustomRange(true);
                  return;
                }
                setPreset(option.value);
                setRange(getReportRange(option.value));
              }}
            />
          ))}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={showCustomRange}
        onClose={() => {
          setShowCustomRange(false);
          setCustomError(undefined);
        }}
        title="Custom range"
        doneLabel="Cancel"
      >
        <Card padding="none">
          <ListRow
            label="Start date"
            value={formatDate(customStart)}
            valueTone="primary"
            onPress={() => setDatePicker('start')}
            chevron={false}
          />
          <ListRow
            label="End date"
            value={formatDate(customEnd)}
            valueTone="primary"
            onPress={() => setDatePicker('end')}
            chevron={false}
            last
          />
        </Card>
        {customError ? (
          <Text variant="small" tone="negative" style={{ marginTop: space.md }}>
            {customError}
          </Text>
        ) : null}
        {datePicker ? (
          <DateTimePicker
            mode="date"
            value={datePicker === 'start' ? customStart : customEnd}
            onChange={(_event, value) => {
              if (value) {
                if (datePicker === 'start') setCustomStart(value);
                else setCustomEnd(value);
              }
              setDatePicker(undefined);
            }}
          />
        ) : null}
        <View style={{ marginTop: space.xl }}>
          <Button
            label="Apply Range"
            onPress={() => {
              try {
                setRange(getCustomRange(customStart, customEnd));
                setPreset('custom');
                setCustomError(undefined);
                setShowCustomRange(false);
              } catch (error) {
                setCustomError(
                  error instanceof Error ? error.message : 'Choose a valid date range.',
                );
              }
            }}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/**
 * The period this report covers, as a pill that opens the picker. It sits
 * directly under the title because every figure below it is meaningless
 * without knowing which dates produced them.
 */
function PeriodPill({ label, onPress }: { label: string; onPress: () => void }) {
  const { palette, space, radius, motion } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Report period, ' + label + '. Change'}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        {
          borderRadius: radius.pill,
          paddingVertical: space.sm,
          paddingHorizontal: space.md + 2,
          gap: space.sm,
          backgroundColor: palette.surfaceRaised,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
      ]}
    >
      <Icon name="calendar" size="inline" color={palette.accent} />
      <Text variant="smallStrong">{label}</Text>
      <Icon name="chevron-down" size="inline" color={palette.textTertiary} />
    </Pressable>
  );
}

/** The donut answers "what is the shape of this", the ranked bars answer "how much, exactly". */
function CategoryCard({
  categories,
  totalMinor,
  currency,
}: {
  categories: CategoryBreakdownItem[];
  totalMinor: number;
  currency: string;
}) {
  const { palette, space } = useTheme();

  if (categories.length === 0) {
    return (
      <Card>
        <Text variant="body" tone="secondary">
          No spending was recorded in this period.
        </Text>
      </Card>
    );
  }

  const segments: DonutSegment[] = categories.map((category) => ({
    key: category.categoryId,
    value: category.amountMinor,
    color: getCategoryIdentity(category.icon).hue,
  }));

  return (
    <Card>
      <View style={styles.donut}>
        <DonutChart
          segments={segments}
          accessibilityLabel={'Spending by category, ' + formatMinorUnits(totalMinor, currency)}
        >
          <Text variant="tab" tone="tertiary">
            Total
          </Text>
          <Text variant="bodyStrong" tabular>
            {splitMinorUnits(totalMinor, currency).integer}
          </Text>
        </DonutChart>
      </View>
      <View
        style={[
          styles.divider,
          {
            backgroundColor: palette.divider,
            marginTop: space.xl,
            marginBottom: space.lg + 2,
          },
        ]}
      />
      <View style={{ gap: space.md + 1 }}>
        {categories.map((category) => (
          <View key={category.categoryId} style={{ gap: space.sm - 2 }}>
            <View style={styles.categoryRow}>
              <Text variant="smallStrong" numberOfLines={1} style={styles.categoryName}>
                {category.categoryName}
              </Text>
              <Money
                minorUnits={category.amountMinor}
                currency={currency}
                size="row"
                showCode={false}
                muted
              />
              <Text variant="caption" tone="tertiary" tabular style={styles.percent}>
                {Math.round(category.percentage)}%
              </Text>
            </View>
            <ProgressBar
              value={category.percentage}
              max={100}
              color={getCategoryIdentity(category.icon).hue}
              accessibilityLabel={
                category.categoryName +
                ', ' +
                formatMinorUnits(category.amountMinor, currency) +
                ', ' +
                Math.round(category.percentage) +
                ' percent of spending'
              }
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

function ReportsSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View>
      <Skeleton width={140} height={30} radius="pill" style={{ marginTop: space.xs }} />
      <Skeleton width={132} height={size.chip} radius="pill" style={{ marginTop: space.md }} />
      <Skeleton height={76} radius={radius.card} style={{ marginTop: space.lg }} />
      {[0, 1].map((section) => (
        <View key={section} style={{ marginTop: space.xxl }}>
          <Skeleton width={140} height={12} radius="pill" style={{ marginBottom: space.md }} />
          <Skeleton height={section === 0 ? 190 : 240} radius={radius.card} />
        </View>
      ))}
    </View>
  );
}

/**
 * Insights are plain factual sentences. The app measures; it does not praise or
 * scold, so none of these congratulate and none of them warn.
 */
function presentInsight(
  insight: ReportInsight,
  currency: string,
  categories: CategoryBreakdownItem[],
): { text: string; icon: IconName; tone: 'positive' | 'negative' | 'neutral' } {
  switch (insight.type) {
    case 'biggest_expense_category': {
      const match = categories.find((item) => item.categoryId === insight.categoryId);
      const identity = getCategoryIdentity(match?.icon ?? null);
      return {
        text: insight.categoryName + ' was your biggest expense category.',
        icon: isIconName(identity.icon) ? identity.icon : 'chart-pie',
        tone: 'neutral',
      };
    }
    case 'expense_increase':
      return {
        text: 'You spent ' + Math.round(insight.percentage) + '% more than last month.',
        icon: 'trending-up',
        tone: 'negative',
      };
    case 'expense_decrease':
      return {
        text: 'You spent ' + Math.abs(Math.round(insight.percentage)) + '% less than last month.',
        icon: 'trending-down',
        tone: 'positive',
      };
    case 'savings':
      return {
        text:
          'You saved ' + formatMinorUnits(insight.amountMinor, currency) + ' during this period.',
        icon: 'wallet',
        tone: 'positive',
      };
    case 'expense_exceeded_income':
      return {
        text:
          'Expenses exceeded income by ' + formatMinorUnits(insight.amountMinor, currency) + '.',
        icon: 'triangle-alert',
        tone: 'negative',
      };
  }
}

function rangeLabel(preset: ReportPreset, range: ReportRange) {
  if (preset !== 'custom') {
    return presets.find((item) => item.value === preset)?.label ?? 'This Month';
  }
  return formatDate(range.start) + ' – ' + formatDate(range.end);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  presets: { flexDirection: 'row', flexWrap: 'wrap' },
  donut: { alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  categoryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  categoryName: { flex: 1 },
  percent: { width: 34, textAlign: 'right' },
});
