import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

type Props = {
  label: string;
  children: ReactNode;
  /** The whole row as one sentence, for a figure a screen reader would otherwise split. */
  accessibilityLabel?: string;
  /** A hairline above the row, for a total. */
  divided?: boolean;
};

/**
 * A label on the left, a figure on the right.
 *
 * The row wraps instead of overflowing: under large text a long label and a crore
 * figure no longer fit side by side, and the figure drops to its own line, still
 * right-aligned, rather than running off the card.
 */
export function FigureRow({ label, children, accessibilityLabel, divided = false }: Props) {
  const { palette, space } = useTheme();
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.row,
        { columnGap: space.md, rowGap: space.xs, paddingVertical: space.sm },
        divided && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.hairline,
          marginTop: space.xs,
          paddingTop: space.md,
        },
      ]}
    >
      <Text variant="body" tone="secondary" style={styles.label}>
        {label}
      </Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  label: { flexShrink: 1, minWidth: 0 },
  value: { marginLeft: 'auto', flexShrink: 1, minWidth: 0, alignItems: 'flex-end' },
});
