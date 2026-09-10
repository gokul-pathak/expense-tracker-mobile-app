import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme, withAlpha } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BannerTone = 'info' | 'warning' | 'negative' | 'positive';

type Props = {
  tone?: BannerTone;
  icon?: IconName;
  message: string;
  action?: { label: string; onPress: () => void };
};

const defaultIcon: Record<BannerTone, IconName> = {
  info: 'info',
  warning: 'triangle-alert',
  negative: 'circle-alert',
  positive: 'circle-check',
};

/**
 * An inline status strip that stays: icon, one line, optional action. Tinted
 * at 10% with a hairline in the same hue. Not a toast.
 */
export function Banner({ tone = 'info', icon, message, action }: Props) {
  const { palette, space, radius } = useTheme();
  const hue = palette[tone];
  return (
    <View
      accessibilityRole="text"
      style={[
        styles.banner,
        {
          backgroundColor: withAlpha(hue, 0.1),
          borderColor: withAlpha(hue, 0.3),
          borderRadius: radius.control,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          gap: space.md,
        },
      ]}
    >
      <Icon name={icon ?? defaultIcon[tone]} size="inline" color={hue} />
      <Text variant="small" style={styles.message}>
        {message}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress}>
          <Text variant="smallStrong" color={hue}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  message: { flex: 1 },
});
