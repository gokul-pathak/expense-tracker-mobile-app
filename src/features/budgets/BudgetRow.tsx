import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryChip, ProgressBar, Text } from '@/components/ui';
import { getCategoryIdentity, useTheme } from '@/theme';

import {
  categoryLabel,
  formatBudgetPercentage,
  getBudgetAccessibilityLabel,
  getBudgetProgressAccessibilityLabel,
  getBudgetRemainderLabel,
  getBudgetSpendLabel,
  isOverBudget,
} from './budget-presentation';
import type { BudgetProgress } from './budget.types';

type Props = {
  progress: BudgetProgress;
  /** Opens the budget. Omitted where the row is a read-only glance, as on Home. */
  onPress?: () => void;
};

/**
 * One category budget: what it covers, the plan, the bar, and the gap.
 *
 * Every state the bar's colour signals is also written out — "remaining", "over
 * budget", "Budget reached", "Nothing spent yet" — because a row that can only
 * be read in colour cannot be read by everyone. The percentage is the true one:
 * the bar is what stops at the marker, never the number beside it.
 *
 * Nothing wraps horizontally beyond the row. The name truncates, the figures sit
 * on their own lines, and every text row is free to grow downwards, so a long
 * category name at the largest text size still lays out rather than clipping.
 */
export function BudgetRow({ progress, onPress }: Props) {
  const { space, motion } = useTheme();
  const categoryIcon = progress.categoryIcon;
  const hue = getCategoryIdentity(categoryIcon).hue;
  const over = isOverBudget(progress);

  const body = (
    <View style={{ gap: space.sm }}>
      <View style={[styles.head, { gap: space.md }]}>
        <CategoryChip categoryIcon={categoryIcon} size={32} />
        <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
          {categoryLabel(progress)}
        </Text>
        <Text variant="captionStrong" tone="tertiary" tabular>
          {formatBudgetPercentage(progress.percentage)}
        </Text>
      </View>

      <Text variant="caption" tone="tertiary" tabular>
        {getBudgetSpendLabel(progress, { code: false })}
      </Text>

      <ProgressBar
        value={progress.spentMinor}
        max={progress.budget.amountMinor}
        color={hue}
        accessibilityValueText={getBudgetProgressAccessibilityLabel(progress)}
      />

      <Text variant="caption" tone={over ? 'negative' : 'secondary'} tabular>
        {getBudgetRemainderLabel(progress, { code: false })}
      </Text>
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={getBudgetAccessibilityLabel(progress)}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={getBudgetAccessibilityLabel(progress)}
      accessibilityHint="Opens this budget"
      onPress={onPress}
      style={({ pressed }) =>
        pressed ? { transform: [{ scale: motion.press.scale }] } : undefined
      }
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, minWidth: 0 },
});
