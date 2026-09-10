import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  EmptyState,
  ErrorState,
  FormScreen,
  NativeDataNotice,
  Screen,
  Skeleton,
} from '@/components/ui';
import type { Transaction } from '@/features/transactions/transaction.types';
import { TransactionEntryForm } from '@/features/transactions/TransactionEntryForm';
import { getTransaction, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

export default function EditTransactionScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [transaction, setTransaction] = useState<Transaction>();
  const [failed, setFailed] = useState(false);
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setFailed(true);
      return;
    }
    setFailed(false);
    try {
      setTransaction(getTransaction(routeId));
    } catch (error) {
      console.error('Could not load transaction for editing.', error);
      setFailed(true);
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
  if (failed) {
    return (
      <FormScreen title="Edit" backIcon="x">
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
  if (!transaction) {
    return (
      <FormScreen title="Edit" backIcon="x">
        <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.xl }} />
      </FormScreen>
    );
  }
  // Transfers, loans and repayments have their own shape and are recorded
  // again rather than edited, so this route only handles the two it can.
  if (transaction.type !== 'expense' && transaction.type !== 'income') {
    return (
      <FormScreen title="Edit" backIcon="x">
        <EmptyState
          illustration="ledger"
          title="This one can't be edited"
          body="Transfers, loans and repayments are recorded rather than amended. Delete it and record it again."
        />
      </FormScreen>
    );
  }
  return <TransactionEntryForm transaction={transaction} type={transaction.type} />;
}
