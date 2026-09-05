import { useLocalSearchParams } from 'expo-router';

import { NativeDataNotice, Screen } from '@/components/ui';
import { MoneyMovementForm } from '@/features/transactions/MoneyMovementForm';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function PersonPaymentScreen() {
  const { id, type, outstanding } = useLocalSearchParams<{
    id: string;
    type: 'received' | 'paid';
    outstanding: string;
  }>();
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return (
    <MoneyMovementForm
      type={type === 'received' ? 'repayment_received' : 'repayment_paid'}
      personId={Number(id)}
      outstandingMinor={Number(outstanding)}
    />
  );
}
