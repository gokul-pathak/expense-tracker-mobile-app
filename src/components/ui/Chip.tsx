import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  /** Overrides the accent for the selected fill and text: a category hue, a tone colour. */
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * A 32pt pill that is either chosen or not. Idle is a hairline outline with no
 * fill, so a row of them is quiet; selected takes a 12% tint of the accent with
 * the accent text. Filter chips, quick-amount chips, category chips.
 *
 * Selection is announced as a radio, not a button, because these always sit in
 * a group where one or more of a fixed set is chosen.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  color,
  disabled = false,
  style,
  accessibilityLabel,
}: Props) {
  const { palette, space, size, radius, motion } = useTheme();
  const active = color ?? palette.accent;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          height: size.chip,
          borderRadius: radius.pill,
          paddingHorizontal: space.lg,
          gap: space.xs + 2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: selected ? 'transparent' : palette.hairline,
          backgroundColor: selected ? palette.accentSoft : 'transparent',
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? (
        <Icon name={icon} size="inline" color={selected ? active : palette.textSecondary} />
      ) : null}
      <Text variant="smallStrong" color={selected ? active : palette.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
