import { Pressable, StyleSheet, View } from 'react-native';

import { Card, DonutChart, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { splitMinorUnits } from '@/utils/money';

import {
  formatBudgetPercentage,
  formatBudgetPercentageCompact,
  getBudgetAccessibilityLabel,
  getBudgetRemainderLabel,
  isOverBudget,
} from './budget-presentation';
import type { BudgetProgress } from './budget.types';

type Props = {
  progress: BudgetProgress;
  /** Opens the overall budget for editing. */
  onPress?: () => void;
};

/**
 * The month's overall plan: a ring, the figures, and the gap.
 *
 * The ring reads as how much of the month's promise is gone. Past 100% it fills
 * entirely in `negative` rather than wrapping — a ring that laps itself reads as
 * being back near the start, which is the opposite of the truth. The exact
 * percentage sits beside the ring as text, so the true figure survives even
 * though the ring cannot draw it.
 *
 * The copy states the figures and stops. No advice, no warning, no suggestion
 * about what to do with the remainder.
 */
export function OverallBudgetCard({ progress, onPress }: Props) {
  const { palette, space, motion } = useTheme();
  const currency = progress.budget.currency;
  const over = isOverBudget(progress);
  const used = Math.min(progress.percentage, 100);

  const card = (
    <Card hero style={[styles.card, { gap: space.xl }]}>
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
      >
        <Text variant="heading" tabular>
          {formatBudgetPercentageCompact(progress.percentage)}
        </Text>
        <Text variant="tab" tone="tertiary">
          used
        </Text>
      </DonutChart>

      <View style={styles.text}>
        <Text variant="eyebrow" tone="tertiary">
          Monthly budget
        </Text>
        <View style={[styles.spend, { marginTop: space.sm }]}>
          <Text variant="heading" tabular tone={over ? 'negative' : 'primary'}>
            {splitMinorUnits(progress.spentMinor, currency).integer}
          </Text>
          <Text variant="small" tone="tertiary" tabular>
            {' of ' + splitMinorUnits(progress.budget.amountMinor, currency).integer}
          </Text>
        </View>
        <Text
          variant="small"
          tone={over ? 'negative' : 'secondary'}
          tabular
          style={{ marginTop: space.xs + 2 }}
        >
          {getBudgetRemainderLabel(progress, { code: false })}
        </Text>
        <Text variant="caption" tone="tertiary" tabular style={{ marginTop: space.xs }}>
          {formatBudgetPercentage(progress.percentage) + ' of budget spent'}
        </Text>
      </View>
    </Card>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={getBudgetAccessibilityLabel(progress)}>
        {card}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={getBudgetAccessibilityLabel(progress)}
      accessibilityHint="Opens the overall budget"
      onPress={onPress}
      style={({ pressed }) =>
        pressed ? { transform: [{ scale: motion.press.scale }] } : undefined
      }
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0 },
  spend: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
});
