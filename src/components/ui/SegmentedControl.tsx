import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type Segment<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/**
 * Two or three mutually exclusive views of the same list: Active/Archived,
 * Expense/Income. A sunken track with a raised thumb, so the chosen segment
 * reads as sitting on top rather than merely being tinted.
 *
 * This is not a filter chip row. Chips add up; segments replace each other, and
 * exactly one is always chosen.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const { palette, space, radius } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.track,
        {
          borderRadius: radius.control - 2,
          padding: space.xs,
          backgroundColor: palette.surfaceSunken,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
      ]}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onChange(segment.value);
            }}
            style={[
              styles.segment,
              { paddingVertical: space.sm, borderRadius: radius.control - 5 },
              selected && { backgroundColor: palette.surfaceRaised },
            ]}
          >
            <Text variant="smallStrong" tone={selected ? 'primary' : 'tertiary'} align="center">
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row' },
  segment: { flex: 1 },
});
