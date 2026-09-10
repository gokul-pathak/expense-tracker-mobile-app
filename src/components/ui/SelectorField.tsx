import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  label: string;
  /** The chosen value. Omit to show `placeholder` in tertiary. */
  value?: string;
  placeholder?: string;
  /** A leading glyph beside the value: an account type, a payment mode. */
  icon?: IconName;
  iconColor?: string;
  /** Anything richer than an icon beside the value — a `CategoryChip`. */
  leading?: ReactNode;
  onPress: () => void;
  error?: string;
  disabled?: boolean;
};

/**
 * The workhorse of every entry form: a 52pt control whose whole job is to open
 * a sheet. Label on the left in tertiary, chosen value on the right with a
 * chevron.
 *
 * Value-on-the-right rather than under the label keeps a stack of these to one
 * line each, so a form with five choices still fits above the keyboard.
 */
export function SelectorField({
  label,
  value,
  placeholder = 'Choose',
  icon,
  iconColor,
  leading,
  onPress,
  error,
  disabled = false,
}: Props) {
  const { palette, space, size, radius, gutter, motion } = useTheme();
  const chosen = value !== undefined && value !== '';

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + ', ' + (chosen ? value : placeholder)}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.field,
          {
            minHeight: size.control,
            borderRadius: radius.control,
            paddingHorizontal: gutter - space.xs,
            gap: space.md,
            backgroundColor: palette.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? palette.negative : palette.hairline,
          },
          pressed && { transform: [{ scale: motion.press.scale }] },
          disabled && styles.disabled,
        ]}
      >
        <Text variant="small" tone="tertiary">
          {label}
        </Text>
        <View style={[styles.value, { gap: space.sm + 2 }]}>
          {leading ??
            (icon ? (
              <Icon name={icon} size={18} color={iconColor ?? palette.textSecondary} />
            ) : null)}
          <Text
            variant="bodyStrong"
            tone={chosen ? 'primary' : 'tertiary'}
            numberOfLines={1}
            style={styles.valueText}
          >
            {chosen ? value : placeholder}
          </Text>
          <Icon name="chevron-right" size={18} color={palette.textTertiary} />
        </View>
      </Pressable>
      {error ? (
        <Text
          variant="caption"
          tone="negative"
          accessibilityRole="alert"
          style={{ marginTop: space.xs + 2, marginLeft: space.xs }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  valueText: { flexShrink: 1 },
  disabled: { opacity: 0.45 },
});
