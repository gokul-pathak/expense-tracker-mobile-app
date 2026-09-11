import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { MAX_RECURRENCE_INTERVAL, type RecurringFrequency } from '@/db/constants';
import { useTheme } from '@/theme';

import { frequencyUnit } from './recurring-presentation';

type Props = {
  value: number;
  onChange: (value: number) => void;
  frequency: RecurringFrequency;
  min?: number;
  max?: number;
};

/**
 * "Every [−] 2 [+] weeks". The unit word follows the chosen frequency and the
 * count, so the control always reads as a sentence. Each button is a full touch
 * target with its own spoken label — an unlabelled [−]/[+] pair is exactly the
 * control a screen reader cannot use.
 */
export function IntervalStepper({
  value,
  onChange,
  frequency,
  min = 1,
  max = MAX_RECURRENCE_INTERVAL,
}: Props) {
  const { palette, space, size, radius } = useTheme();
  const unit = frequencyUnit(frequency, value);

  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(next);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" tone="tertiary">
        Repeat every
      </Text>
      <View
        style={[
          styles.row,
          {
            minHeight: size.control,
            borderRadius: radius.control,
            paddingHorizontal: space.sm,
            backgroundColor: palette.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.hairline,
          },
        ]}
      >
        <StepButton
          icon="minus"
          label="Decrease interval"
          disabled={value <= min}
          onPress={() => step(-1)}
        />
        <View accessible accessibilityLabel={'Every ' + value + ' ' + unit} style={styles.value}>
          <Text variant="bodyStrong" tabular align="center">
            {value}
          </Text>
          <Text variant="small" tone="secondary" align="center">
            {unit}
          </Text>
        </View>
        <StepButton
          icon="plus"
          label="Increase interval"
          disabled={value >= max}
          onPress={() => step(1)}
        />
      </View>
    </View>
  );
}

function StepButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'minus' | 'plus';
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { palette, size, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          width: size.touchTarget,
          height: size.touchTarget,
          borderRadius: radius.control - 4,
          backgroundColor: palette.surfaceSunken,
        },
        pressed && !disabled && { opacity: 0.6 },
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size="row" color={disabled ? palette.textTertiary : palette.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
  },
  button: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
});
