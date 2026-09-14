import { Pressable, StyleSheet, View } from 'react-native';

import { Money, Text } from '@/components/ui';
import type { InvestmentAssetType } from '@/db/constants';
import { useTheme } from '@/theme';

import {
  formatTradeDate,
  TRADE_TYPE_LABELS,
  tradeAccessibilityLabel,
  tradeAccountLine,
  tradeCashDirection,
  tradeDetailLine,
} from './investment-presentation';
import type { TradeHistoryEntry } from './investment.types';

type Props = {
  trade: TradeHistoryEntry;
  assetType: InvestmentAssetType;
  onPress: () => void;
  last?: boolean;
};

/**
 * One event in an asset's history: what it was and when, the quantity, price and
 * fee, and on the right the cash it moved — out of an account for a buy, into one
 * for a sale or a dividend. The cash is the linked transaction's own amount.
 */
export function TradeHistoryRow({ trade, assetType, onPress, last = false }: Props) {
  const { palette, space, size, gutter, motion } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tradeAccessibilityLabel(trade, assetType)}
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
        <View style={[styles.title, { columnGap: space.sm }]}>
          <Text variant="bodyStrong">{TRADE_TYPE_LABELS[trade.tradeType]}</Text>
          <Text variant="caption" tone="tertiary">
            {formatTradeDate(trade.tradeDate)}
          </Text>
        </View>
        <Text variant="caption" tone="tertiary" tabular>
          {tradeDetailLine(trade, assetType)}
        </Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {tradeAccountLine(trade)}
        </Text>
      </View>
      <Money
        minorUnits={trade.cashEffect.amountMinor}
        currency={trade.currency}
        size="row"
        direction={tradeCashDirection(trade)}
        showCode={false}
        align="right"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
});
