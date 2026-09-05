import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import {
  isLocalFinanceDataAvailable,
  listActiveAccounts,
  listArchivedAccounts,
} from '@/features/ui/data';
import type { Account } from '@/features/accounts/account.types';
import { formatMinorUnits } from '@/utils/money';

export default function AccountsScreen() {
  const [archived, setArchived] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setAccounts(archived ? listArchivedAccounts() : listActiveAccounts());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [archived]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (loading)
    return (
      <Screen>
        <ScreenState title="Loading accounts" description="Reading your local accounts..." />
      </Screen>
    );
  if (failed)
    return (
      <Screen>
        <ScreenState
          title="Could not load accounts"
          description="Your local data could not be read."
          retry={load}
        />
      </Screen>
    );

  const startingMoney = accounts.reduce((total, account) => total + account.openingBalanceMinor, 0);
  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Accounts
        </AppText>
        <AppText color={colors.textMuted}>
          Starting balances only. Transactions are not included yet.
        </AppText>
      </View>
      <View style={styles.segment}>
        <Segment label="Active" selected={!archived} onPress={() => setArchived(false)} />
        <Segment label="Archived" selected={archived} onPress={() => setArchived(true)} />
      </View>
      {!archived && accounts.length > 0 ? (
        <Card style={styles.total}>
          <AppText color={colors.textMuted}>Starting Money</AppText>
          <AppText variant="heading" weight="700">
            {formatMinorUnits(startingMoney, accounts[0]?.currency ?? 'NPR')}
          </AppText>
        </Card>
      ) : null}
      {accounts.length === 0 ? (
        <ScreenState
          title={archived ? 'No archived accounts.' : 'No accounts yet.'}
          description={
            archived
              ? 'Archived accounts will appear here.'
              : 'Add an account to record where your money is kept.'
          }
        />
      ) : (
        accounts.map((account) => (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${account.name}`}
            onPress={() => router.push(`/accounts/${account.id}` as never)}
          >
            <Card style={styles.row}>
              <View>
                <AppText weight="700">{account.name}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {account.type.replace('_', ' ')}
                </AppText>
              </View>
              <AppText weight="700">
                {formatMinorUnits(account.openingBalanceMinor, account.currency)}
              </AppText>
            </Card>
          </Pressable>
        ))
      )}
      <AppButton label="+ Add Account" onPress={() => router.push('/accounts/new' as never)} />
    </Screen>
  );
}
function Segment({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segmentItem, selected && styles.segmentSelected]}
    >
      <AppText weight="600" color={selected ? colors.surface : colors.textMuted}>
        {label}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.xs,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  segmentSelected: { backgroundColor: colors.primary },
  total: { gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
