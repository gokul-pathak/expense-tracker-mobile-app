import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = {
  title: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  style?: StyleProp<ViewStyle>;
};

/** Eyebrow label left, optional text action right, 8pt below. */
export function SectionHeader({ title, action, style }: Props) {
  const { space, size } = useTheme();
  return (
    <View style={[styles.row, { marginBottom: space.sm }, style]}>
      <Text variant="eyebrow" tone="tertiary">
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
      ) : null}
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
