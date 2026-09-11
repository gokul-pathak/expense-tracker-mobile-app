import { NativeDataNotice, Screen } from '@/components/ui';
import { RecurringForm } from '@/features/recurring/RecurringForm';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function NewRecurringScreen() {
  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  return <RecurringForm />;
}
