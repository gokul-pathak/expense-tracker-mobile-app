import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

type Props = { first: boolean; last: boolean; children: ReactNode };

/**
 * One row of a virtualized list, drawn as a slice of a card.
 *
 * A `FlatList` cannot put its rows inside a `<Card>` without giving up
 * virtualization, and a long trade history needs virtualization. So each row
 * carries the card's surface, side hairlines and — at either end — its rounded
 * corners, and the list reads as one card of hairline-separated rows.
 */
export function CardListItem({ first, last, children }: Props) {
  const { palette, radius } = useTheme();
  return (
    <View
      style={[
        styles.item,
        { backgroundColor: palette.surface, borderColor: palette.hairline },
        first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopLeftRadius: radius.card,
          borderTopRightRadius: radius.card,
        },
        last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomLeftRadius: radius.card,
          borderBottomRightRadius: radius.card,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
