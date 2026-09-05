import { NativeDataNotice, Screen } from '@/components/ui';
import { TransactionEntryForm } from '@/features/transactions/TransactionEntryForm';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function NewExpenseScreen() {
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return <TransactionEntryForm type="expense" />;
}
