import { Pressable, StyleSheet, View } from 'react-native';

import { Money, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import { GainLine } from './GainLine';
import { holdingAccessibilityLabel, holdingDetailLine } from './investment-presentation';
import type { AssetHolding } from './investment.types';

type Props = {
  holding: AssetHolding;
  onPress: () => void;
  last?: boolean;
};

/**
 * One asset in the portfolio list: name and symbol, then quantity, average cost
 * and price on one quiet line, with the current value and unrealized gain on the
 * right.
 *
 * A holding without a price says so in place of a value. It never shows zero,
 * because a figure of nothing reads as "worthless", which nobody has said.
 */
export function HoldingRow({ holding, onPress, last = false }: Props) {
  const { palette, space, size, gutter, motion } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={holdingAccessibilityLabel(holding)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.transactionRow,
          paddingHorizontal: gutter - space.xs,
          paddingVertical: space.md,
          gap: space.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: palette.divider,
        },
        pressed && {
          backgroundColor: palette.surfaceRaised,
          transform: [{ scale: motion.press.scale }],
        },
      ]}
    >
      <View style={styles.text}>
        <View style={[styles.name, { columnGap: space.sm }]}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {holding.name}
          </Text>
          {holding.symbol ? (
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {holding.symbol}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="tertiary" tabular>
          {holdingDetailLine(holding)}
        </Text>
      </View>
      <View style={styles.figures}>
        <Figures holding={holding} />
      </View>
    </Pressable>
  );
}

function Figures({ holding }: { holding: AssetHolding }) {
  switch (holding.status) {
    case 'priced':
      return (
        <>
          <Money
            minorUnits={holding.marketValueMinor ?? 0}
            currency={holding.currency}
            size="row"
            showCode={false}
            align="right"
          />
          <GainLine
            minorUnits={holding.unrealizedGainMinor ?? 0}
            currency={holding.currency}
            kind="unrealized"
            align="right"
          />
        </>
      );
    case 'unpriced':
      return (
        <Text variant="caption" tone="tertiary" align="right">
          No current price
        </Text>
      );
    case 'invalid':
      return (
        <Text variant="caption" tone="negative" align="right">
          Needs attention
        </Text>
      );
    case 'closed':
      return holding.tradeCount === 0 ? null : (
        <GainLine
          minorUnits={holding.realizedGainMinor}
          currency={holding.currency}
          kind="realized"
          align="right"
        />
      );
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { flexDirection: 'row', alignItems: 'baseline', minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  figures: { flexShrink: 1, minWidth: 0, maxWidth: '50%', alignItems: 'flex-end', gap: 2 },
});
