import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScreen,
  Icon,
  isIconName,
  Money,
  NativeDataNotice,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/components/ui';
import type { Account } from '@/features/accounts/account.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getAccountBalance,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
  listArchivedAccounts,
} from '@/features/ui/data';
import { accountTypeIcon, useTheme } from '@/theme';

type Scope = 'active' | 'archived';
type AccountBalance = { account: Account; balanceMinor: number };

const scopes = [
  { value: 'active' as const, label: 'Active' },
  { value: 'archived' as const, label: 'Archived' },
];

export default function AccountsScreen() {
  const { space } = useTheme();
  const [scope, setScope] = useState<Scope>('active');
  const [entries, setEntries] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      const accounts = scope === 'active' ? listActiveAccounts() : listArchivedAccounts();
      setEntries(
        accounts.map((account) => ({ account, balanceMinor: getAccountBalance(account.id) })),
      );
    } catch (error) {
      console.error('Could not load accounts.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  const currencies = new Set(entries.map((entry) => entry.account.currency));
  // A single figure across two currencies would be arithmetic on unlike units,
  // so the total appears only when every listed account agrees on one.
  const sharedCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
  const totalMinor = entries.reduce((sum, entry) => sum + entry.balanceMinor, 0);

  return (
    <FormScreen
      title="Accounts"
      footer={
        entries.length > 0 && !loading && !failed ? (
          <Button
            label="Add Account"
            variant="text"
            icon="plus"
            fullWidth
            onPress={() => router.push('/accounts/new' as never)}
          />
        ) : undefined
      }
    >
      <View style={{ marginTop: space.sm }}>
        <SegmentedControl
          segments={scopes}
          value={scope}
          onChange={setScope}
          accessibilityLabel="Show active or archived accounts"
        />
      </View>

      {loading ? (
        <AccountsSkeleton />
      ) : failed ? (
        <ErrorState
          message="Your local accounts could not be read. Your data is safe."
          onRetry={load}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          illustration="card"
          title={scope === 'active' ? 'No accounts yet' : 'Nothing archived'}
          body={
            scope === 'active'
              ? 'Add the accounts you keep money in. Every transaction is recorded against one.'
              : 'Accounts you archive are kept here so their history stays intact.'
          }
          action={
            scope === 'active'
              ? { label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }
              : undefined
          }
        />
      ) : (
        <>
          {sharedCurrency ? (
            <Card style={{ marginTop: space.lg }}>
              <Text variant="eyebrow" tone="tertiary">
                Total balance
              </Text>
              <View style={{ marginTop: space.sm }}>
                <Money minorUnits={totalMinor} currency={sharedCurrency} size="feature" />
              </View>
            </Card>
          ) : null}

          <View style={{ marginTop: space.lg, gap: space.md }}>
            {entries.map((entry) => (
              <AccountRow key={entry.account.id} entry={entry} />
            ))}
          </View>
        </>
      )}
    </FormScreen>
  );
}

/**
 * The type icon is monochrome, not a category hue. An account is a container
 * rather than a kind of spending, and giving it a colour would put it in
 * competition with the balance beside it.
 */
function AccountRow({ entry }: { entry: AccountBalance }) {
  const { palette, space, size, radius, motion } = useTheme();
  const { account, balanceMinor } = entry;
  const iconKey = accountTypeIcon[account.type];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={account.name + ', ' + typeLabel(account.type)}
      onPress={() => router.push(`/accounts/${account.id}` as never)}
      style={({ pressed }) => [
        styles.row,
        {
          borderRadius: radius.button,
          padding: space.lg,
          gap: space.md + 2,
          backgroundColor: palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
      ]}
    >
      <View
        style={[
          styles.chip,
          {
            width: size.buttonSmall,
            height: size.buttonSmall,
            borderRadius: size.categoryChipRadius,
            backgroundColor: palette.surfaceRaised,
          },
        ]}
      >
        <Icon
          name={isIconName(iconKey) ? iconKey : 'wallet'}
          size="row"
          color={palette.textSecondary}
        />
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {account.name}
        </Text>
        <Text variant="caption" tone="tertiary">
          {typeLabel(account.type)}
        </Text>
      </View>
      <Money
        minorUnits={balanceMinor}
        currency={account.currency}
        size="row"
        showCode={false}
        align="right"
      />
    </Pressable>
  );
}

function AccountsSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View>
      <Skeleton height={92} radius={radius.card} style={{ marginTop: space.lg }} />
      <View style={{ marginTop: space.lg, gap: space.md }}>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={size.transactionRow + 8} radius={radius.button} />
        ))}
      </View>
    </View>
  );
}

function typeLabel(accountType: string) {
  return accountType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 1 },
});
