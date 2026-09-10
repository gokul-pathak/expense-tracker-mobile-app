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
  /**
   * A quiet second line under the chosen value: an account's current balance.
   * Only for a fact about the value itself, never a hint about the control.
   */
  detail?: string;
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
  detail,
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
        accessibilityLabel={
          label + ', ' + (chosen ? value : placeholder) + (detail && chosen ? ', ' + detail : '')
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.field,
          {
            minHeight: size.control,
            paddingVertical: detail && chosen ? space.sm : 0,
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
        <Text variant="small" tone="tertiary" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        <View style={styles.right}>
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
          {detail && chosen ? (
            // Sits under the value rather than the label, because it describes
            // what was chosen. The chevron's width is left clear so the line
            // ends where the value does.
            <Text
              variant="caption"
              tone="tertiary"
              numberOfLines={1}
              align="right"
              style={{ marginTop: 1, marginRight: space.lg + space.xs }}
            >
              {detail}
            </Text>
          ) : null}
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
  // The label keeps its width and the value side gives way, so a long account
  // name truncates instead of running over the label beside it.
  //
  // `right` stacks the value over its detail, which makes it a column, and in a
  // column `flexShrink` governs height rather than width. Right-aligning it with
  // `alignItems` would size both lines to their own content and let them spill
  // sideways, so the rows stretch to the wrapper's width instead and each one
  // pushes its own content to the right.
  label: { flexShrink: 0 },
  right: { flexShrink: 1, minWidth: 0 },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  valueText: { flexShrink: 1, minWidth: 0 },
  disabled: { opacity: 0.45 },
});
