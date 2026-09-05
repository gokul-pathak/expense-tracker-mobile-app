import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { TransactionEntryForm } from '@/features/transactions/TransactionEntryForm';
import type { Transaction } from '@/features/transactions/transaction.types';
import { getTransaction, isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [transaction, setTransaction] = useState<Transaction>();
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable || !id) return;
    setFailed(false);
    try {
      setTransaction(getTransaction(Number(id)));
    } catch (error) {
      console.error('Could not load transaction for editing.', error);
      setFailed(true);
    }
  }, [id]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (failed)
    return (
      <Screen>
        <ScreenState
          title="Transaction unavailable"
          description="This transaction may have been deleted."
          retry={load}
        />
      </Screen>
    );
  if (!transaction)
    return (
      <Screen>
        <ScreenState
          title="Loading transaction"
          description="Preparing this transaction for editing..."
        />
      </Screen>
    );
  if (transaction.type !== 'expense' && transaction.type !== 'income')
    return (
      <Screen>
        <ScreenState
          title="Unsupported transaction"
          description="This transaction type cannot be edited here."
        />
      </Screen>
    );
  return <TransactionEntryForm transaction={transaction} type={transaction.type} />;
}
