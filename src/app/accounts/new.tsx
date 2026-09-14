import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
  /**
   * Set on the first tap and cleared only if saving fails. A second tap queued
   * before the screen closes would otherwise create a second account with the same
   * opening balance, and every total would count it twice.
   */
  const submitting = useRef(false);

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
    if (openingBalanceMinor === null || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      createAccount({ ...values, openingBalanceMinor, icon: values.icon || undefined });
      router.back();
    } catch (caught) {
      submitting.current = false;
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
}
