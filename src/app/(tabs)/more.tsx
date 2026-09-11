import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Icon,
  LargeTitle,
  ListRow,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { useCloudAuth } from '@/features/cloud-auth/auth.provider';
import { useCloudSync } from '@/features/sync/sync.provider';
import type { CloudSyncStatus } from '@/features/sync/sync-status';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import { formatPeriodMonth } from '@/features/budgets/budget.period';
import {
  getPeopleFinancialSummary,
  getRecurringHomeSummary,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
  listActivePeople,
  listBudgetsForMonth,
  listCategories,
  listRecurringTemplates,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

type Counts = {
  accounts: number;
  people: number;
  peoplePending: number;
  budgets: number;
  categories: number;
  recurring: number;
  recurringDue: number;
};

export default function MoreScreen() {
  const { space } = useTheme();
  const [counts, setCounts] = useState<Counts>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      const summary = getPeopleFinancialSummary();
      const recurring = getRecurringHomeSummary({ previewLimit: 0 });
      setCounts({
        accounts: listActiveAccounts().length,
        people: listActivePeople().length,
        peoplePending: summary.people.filter((person) => person.status !== 'settled').length,
        budgets: listBudgetsForMonth(formatPeriodMonth(new Date())).length,
        categories: listCategories().length,
        recurring: listRecurringTemplates().length,
        recurringDue: recurring.dueCount,
      });
    } catch (error) {
      console.error('Could not load your setup.', error);
      setFailed(true);
    }
  }, []);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen tabBar>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Screen tabBar>
        <ErrorState
          message="Your local setup could not be read. Your data is safe."
          onRetry={load}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll tabBar>
      <LargeTitle title="More" />

      <View style={{ marginTop: space.lg }}>
        <IdentityCard />
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Your Money" />
        <Card padding="none">
          <ListRow
            icon="wallet"
            label="Accounts"
            value={counts ? countLabel(counts.accounts, 'active') : undefined}
            trailing={counts ? undefined : <ValueSkeleton />}
            onPress={() => router.push('/accounts' as never)}
          />
          <ListRow
            icon="users"
            label="People"
            value={counts ? peopleLabel(counts) : undefined}
            trailing={counts ? undefined : <ValueSkeleton />}
            onPress={() => router.push('/people' as never)}
          />
          <ListRow
            icon="target"
            label="Budgets"
            value={counts ? budgetLabel(counts.budgets) : undefined}
            trailing={counts ? undefined : <ValueSkeleton />}
            onPress={() => router.push('/budgets' as never)}
          />
          <ListRow
            icon="tag"
            label="Categories"
            value={counts ? String(counts.categories) : undefined}
            trailing={counts ? undefined : <ValueSkeleton />}
            onPress={() => router.push('/categories' as never)}
          />
          <ListRow
            icon="repeat"
            label="Recurring"
            value={counts ? recurringLabel(counts) : undefined}
            valueTone={counts && counts.recurringDue > 0 ? 'warning' : 'tertiary'}
            trailing={counts ? undefined : <ValueSkeleton />}
            onPress={() => router.push('/recurring' as never)}
            last
          />
        </Card>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="App" />
        <Card padding="none">
          <ListRow
            icon="settings"
            label="Settings"
            onPress={() => router.push('/settings' as never)}
          />
          <CloudSyncRow />
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Who this data belongs to, and whether it exists anywhere but this phone. It
 * sits above the lists because "local only" is the single most consequential
 * fact about the app, and someone should never have to go looking for it.
 */
function IdentityCard() {
  const { palette, space, size, radius } = useTheme();
  const { user } = useCloudAuth();
  const { status } = useCloudSync();
  const linked = user?.email != null && status !== 'local_only' && status !== 'unconfigured';

  return (
    <Card>
      <View style={[styles.identity, { gap: space.md + 2 }]}>
        <View
          style={[
            styles.avatar,
            {
              width: size.touchTarget,
              height: size.touchTarget,
              borderRadius: radius.control,
              backgroundColor: palette.surfaceSunken,
            },
          ]}
        >
          <Icon
            name={linked ? 'cloud-check' : 'hard-drive'}
            size="row"
            color={linked ? palette.accent : palette.textSecondary}
          />
        </View>
        <View style={styles.identityText}>
          {linked ? (
            <>
              <Text variant="bodyStrong" numberOfLines={1}>
                {user?.email}
              </Text>
              <Text variant="caption" tone="tertiary">
                Signed in to Cloud Sync
              </Text>
            </>
          ) : (
            <>
              <Text variant="bodyStrong">Local only</Text>
              <Text variant="caption" tone="tertiary">
                Your records live on this device and nowhere else.
              </Text>
            </>
          )}
        </View>
      </View>
      {linked ? null : (
        <View style={{ marginTop: space.lg }}>
          <Button
            label="Set up sync"
            variant="secondary"
            onPress={() => router.push('/cloud-sync' as never)}
          />
        </View>
      )}
    </Card>
  );
}

/** Sync status is the one right-hand value on this screen that carries colour. */
function CloudSyncRow() {
  const { status } = useCloudSync();
  const presentation = presentSyncStatus(status);
  return (
    <ListRow
      icon="cloud"
      label="Cloud Sync"
      value={presentation.label}
      valueTone={presentation.tone}
      chevron={false}
      onPress={() => router.push('/cloud-sync' as never)}
      accessibilityLabel={'Cloud Sync, ' + presentation.label}
    />
  );
}

/**
 * The wording never overstates what happened. "Synced" is the strongest claim
 * the app makes about someone's money, and anything short of a completed cycle
 * says something weaker.
 */
function presentSyncStatus(status: CloudSyncStatus): {
  label: string;
  tone: 'positive' | 'negative' | 'warning' | 'tertiary';
} {
  switch (status) {
    case 'synced':
      return { label: 'Synced', tone: 'positive' };
    case 'syncing':
      return { label: 'Syncing', tone: 'tertiary' };
    case 'linking':
      return { label: 'Linking', tone: 'tertiary' };
    case 'pending_changes':
      return { label: 'Pending', tone: 'warning' };
    case 'offline':
      return { label: 'Offline', tone: 'warning' };
    case 'auth_required':
      return { label: 'Sign in needed', tone: 'warning' };
    case 'setup_required':
      return { label: 'Setup needed', tone: 'warning' };
    case 'reconciliation_required':
      return { label: 'Review needed', tone: 'warning' };
    case 'attention_required':
      return { label: 'Needs attention', tone: 'negative' };
    case 'account_mismatch':
      return { label: 'Wrong account', tone: 'negative' };
    case 'error':
      return { label: 'Failed', tone: 'negative' };
    case 'unconfigured':
      return { label: 'Unavailable', tone: 'tertiary' };
    case 'local_only':
      return { label: 'Off', tone: 'tertiary' };
  }
}

function countLabel(count: number, suffix: string) {
  return count + ' ' + suffix;
}

/** Budgets are counted for this month, since a budget only ever describes one. */
function budgetLabel(count: number) {
  if (count === 0) return 'None set';
  return count === 1 ? '1 this month' : count + ' this month';
}

/** Recurring shows what needs handling when anything does, and how many plans exist otherwise. */
function recurringLabel(counts: Counts) {
  if (counts.recurringDue > 0) return counts.recurringDue + ' due';
  if (counts.recurring === 0) return 'None';
  return String(counts.recurring);
}

/** People are counted by what needs doing when anything does, and by size when nothing does. */
function peopleLabel(counts: Counts) {
  if (counts.peoplePending > 0) return counts.peoplePending + ' pending';
  return String(counts.people);
}

function ValueSkeleton() {
  return <Skeleton width={54} height={13} radius="pill" />;
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
});
