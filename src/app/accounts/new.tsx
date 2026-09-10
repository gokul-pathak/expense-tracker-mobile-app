import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { AccountForm, type AccountFormValues } from '@/features/accounts/AccountForm';
import { createAccount, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';

export default function NewAccountScreen() {
  const { space } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  return (
    <FormScreen title="New Account" backIcon="x">
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}
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
