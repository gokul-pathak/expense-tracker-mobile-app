import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'destructive';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** An action in flight. The label stays so the button keeps its width. */
  loading?: boolean;
  icon?: IconName;
  /** 40pt instead of 48pt, for inline and card-footer actions. */
  small?: boolean;
  /** Text buttons hug their label; filled buttons fill the row unless told not to. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
};

/**
 * Four variants and no more. Primary flips per scheme (champagne on ink in
 * dark, ink on paper in light) and destructive is a text button, never a
 * filled red block, except inside a confirmation dialog.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  small = false,
  fullWidth,
  accessibilityLabel,
}: Props) {
  const { palette, radius, space, size, motion } = useTheme();
  const filled = variant === 'primary' || variant === 'secondary';
  const stretch = fullWidth ?? filled;
  const inactive = disabled || loading;

  const foreground =
    variant === 'primary'
      ? palette.onPrimaryFill
      : variant === 'text'
        ? palette.accent
        : variant === 'destructive'
          ? palette.negative
          : palette.textPrimary;

  const handlePress = () => {
    if (variant === 'primary' && Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: small ? size.buttonSmall : size.button,
          borderRadius: radius.control,
          paddingHorizontal: filled ? space.xl : space.md,
          alignSelf: stretch ? 'stretch' : 'flex-start',
          gap: space.sm,
        },
        variant === 'primary' && {
          backgroundColor: pressed ? palette.accentPressed : palette.primaryFill,
        },
        variant === 'secondary' && {
          backgroundColor: pressed ? palette.surfaceRaised : palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
        !filled && pressed && { opacity: 0.7 },
        pressed && !inactive && { transform: [{ scale: motion.press.scale }] },
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Icon name={icon} size="inline" color={foreground} />
      ) : null}
      <View style={styles.labelWrap}>
        <Text variant="bodyStrong" color={foreground} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: { flexShrink: 1 },
  disabled: { opacity: 0.45 },
});
