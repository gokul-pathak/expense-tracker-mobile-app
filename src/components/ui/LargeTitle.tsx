import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Action = {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  /** A 7pt accent dot on the button, for "filters are active" and nothing louder. */
  badge?: boolean;
};

type Props = {
  title: string;
  /** A circular icon button on the right. */
  action?: Action;
  /** Anything other than an icon button on the right: a chip, a text action. */
  trailing?: ReactNode;
};

/** The 28pt screen title in the content flow, with an optional round action beside it. */
export function LargeTitle({ title, action, trailing }: Props) {
  const { space } = useTheme();
  return (
    <View style={[styles.row, { gap: space.md, marginTop: space.xs }]}>
      <Text variant="title" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {action ? <RoundAction {...action} /> : trailing}
    </View>
  );
}

/**
 * 40pt circle on `surfaceRaised` behind a hairline. It reads as a control
 * without a label because the icon is doing the naming, so the accessible label
 * is required rather than optional.
 */
function RoundAction({ icon, onPress, accessibilityLabel, badge = false }: Action) {
  const { palette, size, space, motion } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        {
          width: size.buttonSmall,
          height: size.buttonSmall,
          borderRadius: size.buttonSmall / 2,
          backgroundColor: palette.surfaceRaised,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
      ]}
    >
      <Icon name={icon} size={18} color={palette.textPrimary} />
      {badge ? (
        <View
          style={[
            styles.badge,
            {
              top: space.sm,
              right: space.sm + 1,
              backgroundColor: palette.accent,
              borderColor: palette.surface,
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1 },
  action: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', width: 7, height: 7, borderRadius: 4, borderWidth: 2 },
});
