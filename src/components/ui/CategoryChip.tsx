import { StyleSheet, View } from 'react-native';

import { getCategoryIdentity, useTheme, withAlpha } from '@/theme';

import { Icon, isIconName, type IconName } from './Icon';

type Props = {
  /** The `icon` key stored on the category. Resolves through `categoryIdentity`. */
  categoryIcon?: string | null;
  /** Override for rows that are not a category: transfers, lending, repayments. */
  icon?: IconName;
  /** Override hue, for the non-category rows. Defaults to the category's hue. */
  color?: string;
  /** Square edge. 36 in rows, 44 in the Quick Add sheet. */
  size?: number;
};

/**
 * A category's identity made visible: a rounded square with its hue at 14%
 * as the fill and its icon in the full hue. Every seeded category has one, so a
 * list of rows reads at a glance rather than by name.
 */
export function CategoryChip({ categoryIcon, icon, color, size: edge }: Props) {
  const { size, iconSize } = useTheme();
  const identity = getCategoryIdentity(categoryIcon);
  const hue = color ?? identity.hue;
  const name: IconName = icon ?? (isIconName(identity.icon) ? identity.icon : 'circle-dashed');
  const side = edge ?? size.categoryChip;
  const glyph = Math.round(side * (iconSize.chip / size.categoryChip));

  return (
    <View
      style={[
        styles.chip,
        {
          width: side,
          height: side,
          borderRadius: Math.round(side * (size.categoryChipRadius / size.categoryChip)),
          backgroundColor: withAlpha(hue, 0.14),
        },
      ]}
    >
      <Icon name={name} size={glyph} color={hue} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
