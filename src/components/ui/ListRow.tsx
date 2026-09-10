import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text, type TextTone } from './Text';

type Props = {
  label: string;
  /** A second line under the label, in caption tertiary. */
  detail?: string;
  icon?: IconName;
  /** Colour for the leading icon. Defaults to secondary text. */
  iconColor?: string;
  /** Any leading element other than an icon: a monogram, a category chip. */
  leading?: ReactNode;
  /** Right-hand value text. */
  value?: string;
  valueTone?: TextTone;
  /** Any right-hand element other than a value: a switch, a status pill. */
  trailing?: ReactNode;
  /** Show a chevron. Defaults to on when the row is pressable and has no trailing element. */
  chevron?: boolean;
  onPress?: () => void;
  /** Label and icon in `negative`. Still a row, never a filled block. */
  destructive?: boolean;
  disabled?: boolean;
  last?: boolean;
  accessibilityLabel?: string;
};

/**
 * Icon, label, value or chevron; 56pt. The Settings and More primitive. Rows
 * sit inside one card and separate with a divider, so a list has one edge
 * rather than six.
 */
export function ListRow({
  label,
  detail,
  icon,
  iconColor,
  leading,
  value,
  valueTone = 'tertiary',
  trailing,
  chevron,
  onPress,
  destructive = false,
  disabled = false,
  last = false,
  accessibilityLabel,
}: Props) {
  const { palette, space, size, gutter } = useTheme();
  const showChevron = chevron ?? (Boolean(onPress) && trailing === undefined);
  const labelColor = destructive ? palette.negative : palette.textPrimary;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? (value ? label + ', ' + value : label)}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={!onPress || disabled}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.listRow,
          paddingHorizontal: gutter - space.xs,
          paddingVertical: space.sm,
          gap: space.md + 2,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: palette.divider,
        },
        pressed && { backgroundColor: palette.surfaceRaised },
        disabled && styles.disabled,
      ]}
    >
      {leading ??
        (icon ? (
          <Icon
            name={icon}
            size="row"
            color={destructive ? palette.negative : (iconColor ?? palette.textSecondary)}
          />
        ) : null)}
      <View style={styles.text}>
        <Text variant="body" color={labelColor} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="smallStrong" tone={valueTone} tabular numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <Icon name="chevron-right" size={18} color={palette.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  disabled: { opacity: 0.45 },
});
