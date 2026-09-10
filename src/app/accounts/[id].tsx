import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorState,
  FormScreen,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import type { Account } from '@/features/accounts/account.types';
import { AccountForm, type AccountFormValues } from '@/features/accounts/AccountForm';
import {
  archiveAccount,
  getAccount,
  getAccountBalance,
  isLocalFinanceDataAvailable,
  unarchiveAccount,
  updateAccount,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';
import { parseRouteId } from '@/utils/route-id';

export default function AccountDetailScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account>();
  const [balanceMinor, setBalanceMinor] = useState<number>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable || routeId === null) {
      setAccount(undefined);
      setError('This link is invalid.');
      return;
    }
    setError('');
    try {
      setAccount(getAccount(routeId));
      setBalanceMinor(getAccountBalance(routeId));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }, [routeId]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (error && !account) {
    return (
      <FormScreen title="Account">
        <ErrorState
          title="Could not load account"
          message={error}
          onRetry={routeId === null ? undefined : load}
        />
      </FormScreen>
    );
  }
  if (!account) {
    return (
      <FormScreen title="Account">
        <Skeleton height={92} radius={radius.card} style={{ marginTop: space.lg }} />
        <View style={{ marginTop: space.xxl, gap: space.lg }}>
          <Skeleton height={size.control} radius={radius.control} />
          <Skeleton height={size.control} radius={radius.control} />
        </View>
      </FormScreen>
    );
  }

  const currentAccount = account;
  const initialValues: AccountFormValues = {
    name: currentAccount.name,
    type: currentAccount.type,
    openingBalance: String(currentAccount.openingBalanceMinor / 100),
    currency: currentAccount.currency,
    icon: currentAccount.icon ?? '',
  };

  return (
    <FormScreen title={currentAccount.name}>
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      {currentAccount.isArchived ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner
            tone="info"
            message="This account is archived. Its history is kept, but it is hidden when recording new transactions."
          />
        </View>
      ) : null}

      {balanceMinor !== undefined ? (
        <Card style={{ marginTop: space.sm }}>
          <Text variant="eyebrow" tone="tertiary">
            Current balance
          </Text>
          <View style={{ marginTop: space.sm }}>
            <Money minorUnits={balanceMinor} currency={currentAccount.currency} size="feature" />
          </View>
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
            Opening balance plus everything recorded against this account.
          </Text>
        </Card>
      ) : null}

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Details" />
        <AccountForm initialValues={initialValues} saving={saving} onSave={save} />
      </View>

      <View style={[{ marginTop: space.xl4, alignItems: 'center' }]}>
        <Button
          label={currentAccount.isArchived ? 'Unarchive Account' : 'Archive Account'}
          variant={currentAccount.isArchived ? 'text' : 'destructive'}
          disabled={saving}
          onPress={() => (currentAccount.isArchived ? toggleArchive() : setConfirming(true))}
        />
      </View>

      <Dialog
        visible={confirming}
        title="Archive this account?"
        message="It is hidden from active accounts and cannot be chosen for new transactions. Everything already recorded against it is kept."
        confirmLabel="Archive"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          toggleArchive();
        }}
      />
    </FormScreen>
  );

  function save(values: AccountFormValues) {
    const openingBalanceMinor = parseMoneyToMinorUnits(values.openingBalance);
    if (openingBalanceMinor === null || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = updateAccount(currentAccount.id, {
        ...values,
        openingBalanceMinor,
        icon: values.icon || null,
      });
      setAccount(updated);
      setBalanceMinor(getAccountBalance(updated.id));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function toggleArchive() {
    try {
      setAccount(
        currentAccount.isArchived
          ? unarchiveAccount(currentAccount.id)
          : archiveAccount(currentAccount.id),
      );
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }
}
