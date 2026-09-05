import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import {
  getTransactionAccountLabel,
  getTransactionDescription,
  getTransactionLabel,
  formatTransactionDateSection,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';
import { formatMinorUnits } from '@/utils/money';

export function TransactionListRow({ transaction }: { transaction: TransactionView }) {
  const expense = transaction.type === 'expense';
  const income = transaction.type === 'income';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${getTransactionLabel(transaction)}, ${formatMinorUnits(transaction.amountMinor, transaction.currency)}, ${getTransactionDescription(transaction)}, ${formatTransactionDateSection(transaction.transactionDate)}`}
      onPress={() => router.push(`/transaction/${transaction.id}` as never)}
    >
      <Card style={styles.row}>
        <View style={styles.rowText}>
          <AppText weight="700">{getTransactionLabel(transaction)}</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {getTransactionDescription(transaction)}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {getTransactionAccountLabel(transaction)}
          </AppText>
        </View>
        <AppText
          weight="700"
          color={expense ? colors.danger : income ? colors.success : colors.text}
        >
          {expense ? '- ' : income ? '+ ' : ''}
          {formatMinorUnits(transaction.amountMinor, transaction.currency)}
        </AppText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowText: { flex: 1, gap: spacing.xs },
});
