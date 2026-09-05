import { useState } from 'react';
import { router } from 'expo-router';

import { AccountForm, type AccountFormValues } from '@/features/accounts/AccountForm';
import { isLocalFinanceDataAvailable, createAccount } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { parseMoneyToMinorUnits } from '@/utils/money';
import { AppText, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';

export default function NewAccountScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return (
    <FormScreen title="New Account">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <AccountForm saving={saving} onSave={save} />
    </FormScreen>
  );
  function save(values: AccountFormValues) {
    const openingBalanceMinor = parseMoneyToMinorUnits(values.openingBalance);
    if (openingBalanceMinor === null || saving) return;
    setSaving(true);
    setError('');
    try {
      createAccount({ ...values, openingBalanceMinor, icon: values.icon || undefined });
      router.back();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
}
