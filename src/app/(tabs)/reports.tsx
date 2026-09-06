import DateTimePicker from '@react-native-community/datetimepicker';
import { type ReactNode, useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import type {
  CategoryBreakdownItem,
  ReportInsight,
  ReportPreset,
  ReportRange,
  ReportSummary,
  TrendPoint,
} from '@/features/reports/reports.types';
import {
  getCustomRange,
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getRecommendedGranularity,
  getReportRange,
  getReportSummary,
  getSimpleInsights,
  getAppSettings,
  isLocalFinanceDataAvailable,
} from '@/features/ui/data';
import { formatMinorUnits } from '@/utils/money';

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
  const [preset, setPreset] = useState<ReportPreset>('this_month');
  const [range, setRange] = useState<ReportRange>(() => getReportRange('this_month'));
  const [data, setData] = useState<ReportData>();
  const [currency, setCurrency] = useState('NPR');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [customEnd, setCustomEnd] = useState(new Date());
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
          title="Loading your report"
          description="Preparing your financial activity..."
        />
      </Screen>
    );
  if (failed || !data)
    return (
      <Screen>
        <ScreenState
          title="We couldn't load this report."
          description="Your local financial data could not be read."
          retry={load}
        />
      </Screen>
    );

  const empty = data.summary.incomeMinor === 0 && data.summary.expenseMinor === 0;
  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="heading" weight="700">
          Reports
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose report range"
          onPress={() => setShowPresets(true)}
          style={styles.rangeButton}
        >
          <AppText color={colors.primary} weight="700">
            {rangeLabel(preset, range)}
          </AppText>
          <AppText color={colors.primary}>Change</AppText>
        </Pressable>
      </View>

      <Card style={styles.summaryCard}>
        <Metric
          label="Income"
          value={data.summary.incomeMinor}
          currency={currency}
          color={colors.success}
        />
        <Metric
          label="Expense"
          value={data.summary.expenseMinor}
          currency={currency}
          color={colors.danger}
        />
        <View style={styles.savings}>
          <Metric
            label="Savings"
            value={data.summary.savingsMinor}
            currency={currency}
            color={data.summary.savingsMinor < 0 ? colors.danger : colors.text}
          />
        </View>
      </Card>

      {empty ? (
        <Card>
          <AppText color={colors.textMuted}>
            No income or expenses recorded for this period.
          </AppText>
        </Card>
      ) : null}

      <Section title="Income vs Expense">
        <Trend trend={data.trend} currency={currency} />
      </Section>

      <Section title="Spending by Category">
        {data.categories.length === 0 ? (
          <Card>
            <AppText color={colors.textMuted}>No spending recorded for this period.</AppText>
          </Card>
        ) : (
          <Card style={styles.categories}>
            {data.categories.map((category) => (
              <CategoryRow key={category.categoryId} category={category} currency={currency} />
            ))}
          </Card>
        )}
      </Section>

      {data.insights.length > 0 ? (
        <Section title="Insights">
          <Card style={styles.insights}>
            {data.insights.map((insight, index) => (
              <AppText key={`${insight.type}-${index}`} color={colors.textMuted}>
                {insightText(insight, currency)}
              </AppText>
            ))}
          </Card>
        </Section>
      ) : null}

      <PresetModal
        visible={showPresets}
        onClose={() => setShowPresets(false)}
        onSelect={(nextPreset) => {
          setShowPresets(false);
          if (nextPreset === 'custom') setShowCustomRange(true);
          else {
            setPreset(nextPreset);
            setRange(getReportRange(nextPreset));
          }
        }}
      />
      <CustomRangeModal
        visible={showCustomRange}
        start={customStart}
        end={customEnd}
        error={customError}
        picker={datePicker}
        onClose={() => {
          setShowCustomRange(false);
          setCustomError(undefined);
        }}
        onPick={setDatePicker}
        onDateChange={(which, value) => {
          if (which === 'start') setCustomStart(value);
          else setCustomEnd(value);
        }}
        onApply={() => {
          try {
            const nextRange = getCustomRange(customStart, customEnd);
            setRange(nextRange);
            setPreset('custom');
            setCustomError(undefined);
            setShowCustomRange(false);
          } catch (error) {
            setCustomError(error instanceof Error ? error.message : 'Choose a valid date range.');
          }
        }}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="subheading" weight="700">
        {title}
      </AppText>
      {children}
    </View>
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
  color: string;
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

function Trend({ trend, currency }: { trend: TrendPoint[]; currency: string }) {
  const maximum = Math.max(1, ...trend.flatMap((point) => [point.incomeMinor, point.expenseMinor]));
  if (trend.length === 0)
    return (
      <Card>
        <AppText color={colors.textMuted}>No trend data for this period.</AppText>
      </Card>
    );
  return (
    <Card style={styles.trend}>
      {trend.map((point) => (
        <View
          key={point.start.getTime()}
          accessible
          accessibilityLabel={`${point.label}: Income ${formatMinorUnits(point.incomeMinor, currency)}, Expense ${formatMinorUnits(point.expenseMinor, currency)}`}
          style={styles.trendRow}
        >
          <AppText variant="caption" weight="600" style={styles.trendLabel}>
            {point.label}
          </AppText>
          <View style={styles.trendBars}>
            <Bar
              label="Income"
              value={point.incomeMinor}
              maximum={maximum}
              color={colors.success}
            />
            <Bar
              label="Expense"
              value={point.expenseMinor}
              maximum={maximum}
              color={colors.danger}
            />
          </View>
        </View>
      ))}
    </Card>
  );
}

function Bar({
  label,
  value,
  maximum,
  color,
}: {
  label: string;
  value: number;
  maximum: number;
  color: string;
}) {
  return (
    <View style={styles.barLine}>
      <AppText variant="caption" color={colors.textMuted} style={styles.barLabel}>
        {label}
      </AppText>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { backgroundColor: color, width: `${(value / maximum) * 100}%` }]}
        />
      </View>
    </View>
  );
}

function CategoryRow({
  category,
  currency,
}: {
  category: CategoryBreakdownItem;
  currency: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${category.categoryName}, ${formatMinorUnits(category.amountMinor, currency)}, ${Math.round(category.percentage)} percent of spending`}
      style={styles.category}
    >
      <View style={styles.categoryHeader}>
        <View>
          <AppText weight="600">{category.categoryName}</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {formatMinorUnits(category.amountMinor, currency)}
          </AppText>
        </View>
        <AppText weight="700">{Math.round(category.percentage)}%</AppText>
      </View>
      <View style={styles.categoryTrack}>
        <View style={[styles.categoryFill, { width: `${category.percentage}%` }]} />
      </View>
    </View>
  );
}

function PresetModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (preset: PresetOption['value']) => void;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modal} onPress={() => undefined}>
          <AppText variant="subheading" weight="700">
            Report period
          </AppText>
          {presets.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              onPress={() => onSelect(option.value)}
              style={styles.option}
            >
              <AppText weight="600">{option.label}</AppText>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CustomRangeModal({
  visible,
  start,
  end,
  error,
  picker,
  onClose,
  onPick,
  onDateChange,
  onApply,
}: {
  visible: boolean;
  start: Date;
  end: Date;
  error?: string;
  picker?: 'start' | 'end';
  onClose: () => void;
  onPick: (value: 'start' | 'end' | undefined) => void;
  onDateChange: (which: 'start' | 'end', value: Date) => void;
  onApply: () => void;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modal}>
          <AppText variant="subheading" weight="700">
            Custom range
          </AppText>
          <DateButton label="Start date" value={start} onPress={() => onPick('start')} />
          <DateButton label="End date" value={end} onPress={() => onPick('end')} />
          {error ? <AppText color={colors.danger}>{error}</AppText> : null}
          {picker ? (
            <DateTimePicker
              mode="date"
              value={picker === 'start' ? start : end}
              onChange={(_event, value) => {
                if (value) onDateChange(picker, value);
                onPick(undefined);
              }}
            />
          ) : null}
          <AppButton label="Apply range" onPress={onApply} />
          <AppButton label="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function DateButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: Date;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label}`}
      onPress={onPress}
      style={styles.dateButton}
    >
      <AppText color={colors.textMuted}>{label}</AppText>
      <AppText weight="600">{formatDate(value)}</AppText>
    </Pressable>
  );
}

function rangeLabel(preset: ReportPreset, range: ReportRange) {
  if (preset !== 'custom')
    return presets.find((item) => item.value === preset)?.label ?? 'This Month';
  return `${formatDate(range.start)} - ${formatDate(range.end)}`;
}
function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
function insightText(insight: ReportInsight, currency: string) {
  switch (insight.type) {
    case 'biggest_expense_category':
      return `${insight.categoryName} was your biggest expense category.`;
    case 'expense_increase':
      return `You spent ${Math.round(insight.percentage)}% more than last month.`;
    case 'expense_decrease':
      return `You spent ${Math.abs(Math.round(insight.percentage))}% less than last month.`;
    case 'savings':
      return `You saved ${formatMinorUnits(insight.amountMinor, currency)} during this period.`;
    case 'expense_exceeded_income':
      return `Expenses exceeded income by ${formatMinorUnits(insight.amountMinor, currency)}.`;
  }
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  header: { gap: spacing.md },
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryCard: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metric: { flexGrow: 1, gap: spacing.xs },
  savings: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: spacing.md,
  },
  section: { gap: spacing.md },
  trend: { gap: spacing.md },
  trendRow: { flexDirection: 'row', gap: spacing.sm },
  trendLabel: { width: 38, paddingTop: 1 },
  trendBars: { flex: 1, gap: spacing.xs },
  barLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 52 },
  barTrack: {
    flex: 1,
    height: 7,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  barFill: { height: '100%', borderRadius: radii.pill },
  categories: { gap: spacing.lg },
  category: { gap: spacing.sm },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  categoryTrack: {
    height: 7,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  categoryFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  insights: { gap: spacing.md },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  modal: {
    gap: spacing.md,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dateButton: {
    gap: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
  },
});
