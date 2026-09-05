import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import {
  AppButton,
  AppText,
  FormScreen,
  NativeDataNotice,
  Screen,
  ScreenState,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import {
  formatTransactionDate,
  getTransactionAccountLabel,
  getTransactionLabel,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';
import {
  deleteTransaction,
  getTransactionView,
  isLocalFinanceDataAvailable,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { formatMinorUnits } from '@/utils/money';

const paymentModeLabels = {
  cash: 'Cash',
  debit_card: 'Debit Card',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  qr: 'QR',
  digital_wallet: 'Digital Wallet',
  cheque: 'Cheque',
  other: 'Other',
} as const;

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [transaction, setTransaction] = useState<TransactionView>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable || !id) return;
    setLoading(true);
    setFailed(false);
    try {
      setTransaction(getTransactionView(Number(id)));
    } catch (caught) {
      console.error('Could not load transaction.', caught);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (loading)
    return (
      <FormScreen title="Transaction">
        <ScreenState
          title="Loading transaction"
          description="Reading this transaction from your local data..."
        />
      </FormScreen>
    );
  if (failed || !transaction)
    return (
      <FormScreen title="Transaction">
        <ScreenState
          title="Transaction unavailable"
          description="This transaction may have been deleted."
          retry={load}
        />
      </FormScreen>
    );

  const transactionId = transaction.id;
  const expense = transaction.type === 'expense';
  const income = transaction.type === 'income';
  const title = getTransactionLabel(transaction);
  return (
    <FormScreen title={title}>
      <View style={styles.content}>
        {error ? <AppText color={colors.danger}>{error}</AppText> : null}
        <View style={styles.amount}>
          <AppText
            color={expense ? colors.danger : income ? colors.success : colors.text}
            weight="700"
          >
            {title}
          </AppText>
          <AppText variant="title" weight="700">
            {expense ? '- ' : income ? '+ ' : ''}
            {formatMinorUnits(transaction.amountMinor, transaction.currency)}
          </AppText>
        </View>
        {transaction.type === 'expense' || transaction.type === 'income' ? (
          <DetailRow
            label={expense ? 'Category' : 'Source'}
            value={getTransactionLabel(transaction)}
          />
        ) : null}
        {transaction.type === 'transfer' ? (
          <>
            <DetailRow label="From" value={transaction.sourceAccountName ?? 'Unknown account'} />
            <DetailRow label="To" value={transaction.destinationAccountName ?? 'Unknown account'} />
          </>
        ) : null}
        {transaction.type === 'lend' || transaction.type === 'repayment_paid' ? (
          <DetailRow label="From" value={transaction.sourceAccountName ?? 'Unknown account'} />
        ) : null}
        {transaction.type === 'borrow' || transaction.type === 'repayment_received' ? (
          <DetailRow label="To" value={transaction.destinationAccountName ?? 'Unknown account'} />
        ) : null}
        {transaction.personName ? (
          <DetailRow label="Person" value={transaction.personName} />
        ) : null}
        {transaction.type === 'expense' || transaction.type === 'income' ? (
          <DetailRow label="Account" value={getTransactionAccountLabel(transaction)} />
        ) : null}
        <DetailRow label="Date" value={formatTransactionDate(transaction.transactionDate)} />
        {transaction.note ? <DetailRow label="Note" value={transaction.note} /> : null}
        {transaction.paymentMode ? (
          <DetailRow label="Payment Mode" value={paymentModeLabels[transaction.paymentMode]} />
        ) : null}
        {transaction.type === 'expense' || transaction.type === 'income' ? (
          <AppButton
            label="Edit"
            onPress={() => router.push(`/transaction/${transaction.id}/edit` as never)}
          />
        ) : null}
        <AppButton
          label={deleting ? 'Deleting...' : 'Delete'}
          disabled={deleting}
          variant="secondary"
          onPress={confirmDelete}
        />
      </View>
    </FormScreen>
  );

  function confirmDelete() {
    Alert.alert('Delete this transaction?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (deleting) return;
          setDeleting(true);
          setError('');
          try {
            deleteTransaction(transactionId);
            router.back();
          } catch (caught) {
            console.error('Could not delete transaction.', caught);
            const message = getUserErrorMessage(caught);
            setError(
              message.includes('cannot exceed money')
                ? "This lending or borrowing record can't be deleted while repayment history exists. Delete the repayment records first."
                : message,
            );
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText color={colors.textMuted}>{label}</AppText>
      <AppText weight="600">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  amount: { gap: spacing.sm, paddingVertical: spacing.md },
  detailRow: {
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.md,
  },
});
