import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Alert } from 'react-native';
import {
  AppButton,
  AppText,
  FormScreen,
  NativeDataNotice,
  Screen,
  ScreenState,
} from '@/components/ui';
import { AccountForm, type AccountFormValues } from '@/features/accounts/AccountForm';
import type { Account } from '@/features/accounts/account.types';
import {
  archiveAccount,
  getAccount,
  isLocalFinanceDataAvailable,
  unarchiveAccount,
  updateAccount,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { colors } from '@/constants/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';
export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    try {
      setAccount(getAccount(Number(id)));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }, [id]);
  useFocusEffect(load);
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (error && !account)
    return (
      <Screen>
        <ScreenState
          title="Could not load account"
          description={error}
          retry={() => router.back()}
        />
      </Screen>
    );
  if (!account)
    return (
      <Screen>
        <ScreenState title="Loading account" description="Reading your local account..." />
      </Screen>
    );
  const currentAccount = account;
  const initialValues: AccountFormValues = {
    name: currentAccount.name,
    type: currentAccount.type,
    openingBalance: String(currentAccount.openingBalanceMinor / 100),
    currency: currentAccount.currency,
    icon: currentAccount.icon ?? '',
  };
  return (
    <FormScreen title="Edit Account">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <AccountForm initialValues={initialValues} saving={saving} onSave={save} />
      <AppButton
        label={currentAccount.isArchived ? 'Unarchive Account' : 'Archive Account'}
        variant="secondary"
        disabled={saving}
        onPress={toggleArchive}
      />
    </FormScreen>
  );
  function save(values: AccountFormValues) {
    const openingBalanceMinor = parseMoneyToMinorUnits(values.openingBalance);
    if (openingBalanceMinor === null || saving) return;
    setSaving(true);
    setError('');
    try {
      setAccount(
        updateAccount(currentAccount.id, {
          ...values,
          openingBalanceMinor,
          icon: values.icon || null,
        }),
      );
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  function toggleArchive() {
    const perform = () => {
      try {
        setAccount(
          currentAccount.isArchived
            ? unarchiveAccount(currentAccount.id)
            : archiveAccount(currentAccount.id),
        );
      } catch (caught) {
        setError(getUserErrorMessage(caught));
      }
    };
    if (currentAccount.isArchived) perform();
    else
      Alert.alert(
        'Archive this account?',
        'It will be hidden from active accounts but kept for historical records.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', style: 'destructive', onPress: perform },
        ],
      );
  }
}
