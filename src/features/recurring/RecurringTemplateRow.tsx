import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryChip, Money, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import {
  describeRecurrence,
  getNextDueLabel,
  getTemplateAccessibilityLabel,
  recurringTypeDirection,
  recurringTypeLabel,
  templateLabel,
} from './recurring-presentation';
import type { LocalDate } from './recurring-schedule';
import type { RecurringTemplateView } from './recurring.types';

type Props = {
  view: RecurringTemplateView;
  asOfDate: LocalDate;
  onPress: () => void;
  last?: boolean;
};

/**
 * One recurring template: what it is, its amount and schedule, and when it is
 * next due. A paused template says "Paused" in words rather than only sitting in
 * a dimmer list, and every state the layout shows is carried in the spoken
 * label, since a screen reader reaches the row as one element.
 *
 * The amount's colour and sign carry direction, and the line beneath names the
 * type in words too — colour alone is not enough to tell an expense from income.
 */
export function RecurringTemplateRow({ view, asOfDate, onPress, last = false }: Props) {
  const { palette, space, gutter, size } = useTheme();
  const nextDue = view.isPaused ? 'Paused' : getNextDueLabel(view, asOfDate);
  const secondary =
    recurringTypeLabel(view.type) + ' · ' + describeRecurrence(view.frequency, view.interval);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={getTemplateAccessibilityLabel(view, asOfDate)}
      accessibilityHint="Opens this recurring transaction"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.transactionRow,
          paddingHorizontal: gutter - space.xs,
          paddingVertical: space.md,
          gap: space.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: palette.divider,
        },
        pressed && { backgroundColor: palette.surfaceRaised },
        view.isPaused && styles.paused,
      ]}
    >
      <CategoryChip categoryIcon={view.categoryIcon} size={size.categoryChip} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {templateLabel(view)}
        </Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {secondary}
        </Text>
        {nextDue ? (
          <Text variant="caption" tone={view.isPaused ? 'secondary' : 'tertiary'} numberOfLines={1}>
            {nextDue}
          </Text>
        ) : null}
      </View>
      <Money
        minorUnits={view.amountMinor}
        currency={view.currency}
        size="row"
        direction={recurringTypeDirection(view.type)}
        showCode={false}
        align="right"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  paused: { opacity: 0.72 },
});
