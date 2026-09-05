import { NativeDataNotice, Screen } from '@/components/ui';
import { MoneyMovementForm } from '@/features/transactions/MoneyMovementForm';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function NewBorrowScreen() {
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return <MoneyMovementForm type="borrow" />;
}
