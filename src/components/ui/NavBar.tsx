import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  title: string;
  /** Omit on a screen with nowhere to go back to. */
  onBack?: () => void;
  /** `arrow-left` returns to the screen behind; `x` abandons an entry form. */
  backIcon?: Extract<IconName, 'arrow-left' | 'x' | 'chevron-left'>;
  backLabel?: string;
  /** The right-hand text action, in the accent. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /** A hairline under the bar. On once the content has scrolled beneath it. */
  divider?: boolean;
};

/**
 * 56pt: a round 40pt back target, a centred title, and at most one text action.
 *
 * The title is absolutely positioned rather than laid out between the two
 * sides, so it stays optically centred whether or not there is an action beside
 * it. A title that shifts when a Save appears reads as a bug.
 */
export function NavBar({
  title,
  onBack,
  backIcon = 'arrow-left',
  backLabel = 'Back',
  action,
  divider = false,
}: Props) {
  const { palette, space, size, gutter, elevation, scheme } = useTheme();

  return (
    <View
      style={[
        styles.bar,
        {
          height: size.navBar,
          paddingHorizontal: gutter - space.xs,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: palette.hairline,
        },
      ]}
    >
      <View pointerEvents="none" style={styles.titleWrap}>
        <Text variant="subheading" numberOfLines={1}>
          {title}
        </Text>
      </View>

      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [
            styles.back,
            scheme === 'light' && elevation.card,
            {
              width: size.buttonSmall,
              height: size.buttonSmall,
              borderRadius: size.buttonSmall / 2,
              backgroundColor: palette.surfaceRaised,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.hairline,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Icon name={backIcon} size="row" color={palette.textPrimary} />
        </Pressable>
      ) : (
        <View style={{ width: size.buttonSmall }} />
      )}

      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: action.disabled }}
          disabled={action.disabled}
          hitSlop={12}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.selectionAsync();
            action.onPress();
          }}
          style={({ pressed }) => [
            { paddingHorizontal: space.xs },
            pressed && styles.pressed,
            action.disabled && styles.disabled,
          ]}
        >
          <Text variant="subheading" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : (
        <View style={{ width: size.buttonSmall }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
