import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  CategoryChip,
  Dialog,
  ErrorState,
  FormScreen,
  ListRow,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import {
  formatTransactionDate,
  getTransactionAccountLabel,
  getTransactionDirection,
  getTransactionLabel,
} from '@/features/transactions/transaction-presentation';
import type { TransactionView } from '@/features/transactions/transaction.types';
import {
  deleteTransaction,
  getTransactionView,
  isLocalFinanceDataAvailable,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

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
  const { space } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [transaction, setTransaction] = useState<TransactionView>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable || routeId === null) {
      setLoading(false);
      setFailed(true);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      setTransaction(getTransactionView(routeId));
    } catch (caught) {
      console.error('Could not load transaction.', caught);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [routeId]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (loading) {
    return (
      <FormScreen title="Transaction">
        <DetailSkeleton />
      </FormScreen>
    );
  }
  if (failed || !transaction) {
    return (
      <FormScreen title="Transaction">
        <ErrorState
          title="Transaction unavailable"
          message={
            routeId === null
              ? 'This link is invalid.'
              : 'This transaction may have been deleted since you opened it.'
          }
          onRetry={routeId === null ? undefined : load}
        />
      </FormScreen>
    );
  }

  const transactionId = transaction.id;
  const label = getTransactionLabel(transaction);
  const direction = getTransactionDirection(transaction);
  const editable = transaction.type === 'expense' || transaction.type === 'income';

  return (
    <FormScreen
      title="Transaction"
      action={
        editable
          ? {
              label: 'Edit',
              onPress: () => router.push(`/transaction/${transactionId}/edit` as never),
            }
          : undefined
      }
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={[styles.hero, { marginTop: space.lg, gap: space.md }]}>
        <CategoryChip categoryIcon={transaction.categoryIcon} size={52} />
        <Money
          minorUnits={transaction.amountMinor}
          currency={transaction.currency}
          size="feature"
          direction={direction}
          align="center"
        />
        <Text variant="body" tone="secondary">
          {label}
        </Text>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Details" />
        <Card padding="none">
          {rowsFor(transaction).map((row, index, rows) => (
            <ListRow
              key={row.label}
              label={row.label}
              value={row.value}
              valueTone="primary"
              chevron={false}
              last={index === rows.length - 1}
            />
          ))}
        </Card>
      </View>

      {transaction.note ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Note" />
          <Card>
            <Text variant="body">{transaction.note}</Text>
          </Card>
        </View>
      ) : null}

      <View style={[styles.destructive, { marginTop: space.xl4 }]}>
        <Button
          label="Delete Transaction"
          variant="destructive"
          loading={deleting}
          onPress={() => setConfirming(true)}
        />
      </View>

      <Dialog
        visible={confirming}
        title="Delete this transaction?"
        message={
          'This removes it from your records and adjusts the balances it affected. It cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </FormScreen>
  );

  function remove() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      deleteTransaction(transactionId);
      setConfirming(false);
      router.back();
    } catch (caught) {
      console.error('Could not delete transaction.', caught);
      const message = getUserErrorMessage(caught);
      setConfirming(false);
      setError(
        message.includes('cannot exceed money')
          ? "This lending or borrowing record can't be deleted while repayment history exists. Delete the repayment records first."
          : message,
      );
    } finally {
      setDeleting(false);
    }
  }
}

/**
 * Which accounts a transaction names depends on what kind it is: a transfer has
 * two, a loan has one and a person, an expense has a category. Building the
 * list here keeps that shape in one place rather than spread over conditionals
 * in the layout.
 */
function rowsFor(transaction: TransactionView): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const unknown = 'Unknown account';

  if (transaction.type === 'expense' || transaction.type === 'income') {
    rows.push({
      label: transaction.type === 'expense' ? 'Category' : 'Source',
      value: getTransactionLabel(transaction),
    });
    rows.push({ label: 'Account', value: getTransactionAccountLabel(transaction) });
  }
  if (transaction.type === 'transfer') {
    rows.push({ label: 'From', value: transaction.sourceAccountName ?? unknown });
    rows.push({ label: 'To', value: transaction.destinationAccountName ?? unknown });
  }
  if (transaction.type === 'lend' || transaction.type === 'repayment_paid') {
    rows.push({ label: 'From', value: transaction.sourceAccountName ?? unknown });
  }
  if (transaction.type === 'borrow' || transaction.type === 'repayment_received') {
    rows.push({ label: 'To', value: transaction.destinationAccountName ?? unknown });
  }
  if (transaction.personName) rows.push({ label: 'Person', value: transaction.personName });

  rows.push({ label: 'Date', value: formatTransactionDate(transaction.transactionDate) });
  if (transaction.paymentMode) {
    rows.push({ label: 'Payment Mode', value: paymentModeLabels[transaction.paymentMode] });
  }
  return rows;
}

function DetailSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Skeleton width={52} height={52} radius={radius.control} style={styles.centred} />
      <Skeleton
        width={180}
        height={32}
        radius="pill"
        style={[styles.centred, { marginTop: space.md }]}
      />
      <Skeleton
        width={110}
        height={16}
        radius="pill"
        style={[styles.centred, { marginTop: space.md }]}
      />
      <View style={{ marginTop: space.xxl }}>
        <Skeleton width={70} height={12} radius="pill" style={{ marginBottom: space.md }} />
        <Skeleton height={size.listRow * 4} radius={radius.card} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center' },
  destructive: { alignItems: 'center' },
  centred: { alignSelf: 'center' },
});
