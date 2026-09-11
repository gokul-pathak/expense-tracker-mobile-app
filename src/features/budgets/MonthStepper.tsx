import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import { getMonthLabel, stepPeriodMonth } from './budget-presentation';
import type { PeriodMonth } from './budget.period';

type Props = {
  month: PeriodMonth;
  onChange: (next: PeriodMonth) => void;
};

/**
 * A month at a time, because a budget is a monthly promise and nothing else.
 *
 * Both directions stay open. A future month is a plan waiting for the spending
 * to arrive, and a past month is a record worth looking back at; neither is a
 * reason to disable an arrow. The arrows carry spoken labels rather than only a
 * chevron, and both meet the 44pt target.
 */
export function MonthStepper({ month, onChange }: Props) {
  const { palette, space, size } = useTheme();

  return (
    <View style={[styles.stepper, { marginTop: space.sm }]}>
      <Arrow
        icon="chevron-left"
        label="Previous month"
        onPress={() => onChange(stepPeriodMonth(month, -1))}
      />
      <Text variant="subheading" accessibilityRole="header">
        {getMonthLabel(month)}
      </Text>
      <Arrow
        icon="chevron-right"
        label="Next month"
        onPress={() => onChange(stepPeriodMonth(month, 1))}
      />
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

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
