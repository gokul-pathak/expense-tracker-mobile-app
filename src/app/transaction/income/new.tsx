import { NativeDataNotice, Screen } from '@/components/ui';
import { TransactionEntryForm } from '@/features/transactions/TransactionEntryForm';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function NewIncomeScreen() {
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return <TransactionEntryForm type="income" />;
}
