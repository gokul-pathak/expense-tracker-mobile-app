import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text, type TextTone } from './Text';

type Props = {
  title: string;
  /** Eyebrow tone. Tertiary for a section of a page, secondary for a date group heading. */
  tone?: TextTone;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Anything other than a text action on the right: a day total, a count. */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Eyebrow label left, optional text action or value right, 8pt below. */
export function SectionHeader({ title, tone = 'tertiary', action, trailing, style }: Props) {
  const { space, size } = useTheme();
  return (
    <View style={[styles.row, { marginBottom: space.sm }, style]}>
      <Text variant="eyebrow" tone={tone}>
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          onPress={action.onPress}
          hitSlop={12}
          style={({ pressed }) => [
            styles.action,
            { minHeight: size.touchTarget - space.md },
            pressed && styles.pressed,
          ]}
        >
          <Text variant="smallStrong" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : (
        trailing
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  action: { justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
