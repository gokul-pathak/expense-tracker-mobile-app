import { Pressable, StyleSheet, View } from 'react-native';

import {
  formatTransactionDateSection,
  getTransactionDirection,
  getTransactionLabel,
  getTransactionSecondaryLine,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';
import { useTheme } from '@/theme';
import { formatMinorUnits } from '@/utils/money';

import { CategoryChip } from './CategoryChip';
import type { IconName } from './Icon';
import { Money } from './Money';
import { Text } from './Text';

type Props = {
  transaction: TransactionView;
  onPress?: () => void;
  /** The last row in a card carries no divider. */
  last?: boolean;
};

/**
 * 68pt: chip, label over a secondary line, trailing tabular amount. The
 * right-aligned amounts are what make a list of these read as a ledger, so the
 * label truncates rather than pushing the amount out of its column.
 */
export function TransactionRow({ transaction, onPress, last = false }: Props) {
  const { palette, space, size, gutter } = useTheme();
  const label = getTransactionLabel(transaction);
  const secondary = getTransactionSecondaryLine(transaction);
  const direction = getTransactionDirection(transaction);
  const chip = chipFor(transaction, palette.textSecondary, palette.accent);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[
        label,
        formatMinorUnits(transaction.amountMinor, transaction.currency),
        secondary,
        formatTransactionDateSection(transaction.transactionDate),
      ].join(', ')}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.transactionRow,
          paddingHorizontal: gutter - space.xs,
          gap: space.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: palette.divider,
        },
        pressed && { backgroundColor: palette.surfaceRaised, transform: [{ scale: 0.99 }] },
      ]}
    >
      <CategoryChip categoryIcon={transaction.categoryIcon} icon={chip.icon} color={chip.color} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {secondary}
        </Text>
      </View>
      <Money
        minorUnits={transaction.amountMinor}
        currency={transaction.currency}
        size="row"
        direction={direction}
        align="right"
      />
    </Pressable>
  );
}

function chipFor(
  transaction: TransactionView,
  neutral: string,
  accent: string,
): { icon?: IconName; color?: string } {
  switch (transaction.type) {
    case 'transfer':
      return { icon: 'arrow-left-right', color: neutral };
    case 'lend':
    case 'borrow':
      return { icon: 'handshake', color: accent };
    case 'repayment_received':
    case 'repayment_paid':
      return { icon: 'hand-coins', color: accent };
    default:
      return {};
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
