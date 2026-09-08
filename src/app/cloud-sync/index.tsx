import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useCloudAuth } from '@/features/cloud-auth/auth.provider';
import { useCloudSync } from '@/features/sync/sync.provider';
import { removeCloudDataFromDevice, signOutKeepingLocalData } from '@/features/sync/sync.service';
import {
  describeLastSync,
  describePendingChanges,
  describeSyncError,
  describeSyncStatus,
} from '@/features/sync/sync-presentation';
import { canSyncNow, isCloudLinked } from '@/features/sync/sync-status';
import { getUserErrorMessage } from '@/features/ui/error-message';

/**
 * Cloud Sync.
 *
 * Every state this screen shows is derived from durable facts on each render, so
 * it cannot claim a device is synchronized while changes are still queued. The
 * screen reads no cloud data of its own: financial figures live on the other
 * screens, from SQLite.
 */
export default function CloudSyncScreen() {
  const { user, status: authStatus } = useCloudAuth();
  const sync = useCloudSync();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      sync.refresh();
      setError('');
      // Reading fresh state on focus keeps the status honest after work done
      // elsewhere, such as a backup restore.
    }, [sync]),
  );

  const copy = describeSyncStatus(sync.status);
  const email = user?.email ?? 'Your cloud account';
  const pending = describePendingChanges(sync.pendingChanges, sync.status === 'offline');
  const linked = isCloudLinked(sync.status);

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Cloud Sync
        </AppText>
        <AppText color={colors.textMuted}>
          Your financial data can be synchronized with your cloud account across devices. It is
          always stored on this device as well.
        </AppText>
      </View>

      <Card style={styles.card}>
        <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={styles.status}>
          <AppText weight="700">{copy.title}</AppText>
          <AppText color={colors.textMuted}>{copy.description}</AppText>
          {pending ? <AppText color={colors.textMuted}>{pending}</AppText> : null}
        </View>
        {sync.status === 'unconfigured' ? null : linked ? (
          <LinkedActions />
        ) : authStatus === 'signed_in' ? (
          <UnlinkedActions />
        ) : (
          <SignedOutActions />
        )}
      </Card>

      {linked ? (
        <Card style={styles.card}>
          <AppText weight="700">Details</AppText>
          <Detail label="Cloud account" value={email} />
          <Detail
            label="Last successful sync"
            value={describeLastSync(sync.lastSuccessfulSyncAt)}
          />
          <Detail label="Changes waiting to upload" value={String(sync.pendingChanges)} />
          <Detail label="Current status" value={copy.title} />
          {describeSyncError(sync.lastError) ? (
            <Detail label="Last problem" value={describeSyncError(sync.lastError)!} />
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <AppText color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );

  function SignedOutActions() {
    return (
      <View style={styles.actions}>
        <AppText color={colors.textMuted}>
          Sign in to sync with your other devices. You can keep using the app without an account.
        </AppText>
        <AppButton label="Sign In" onPress={() => router.push('/cloud-sync/sign-in' as never)} />
        <AppButton
          label="Create Account"
          variant="secondary"
          onPress={() => router.push('/cloud-sync/sign-up' as never)}
        />
      </View>
    );
  }

  function UnlinkedActions() {
    return (
      <View style={styles.actions}>
        <Detail label="Cloud account" value={email} />
        <AppButton
          label="Set Up Cloud Sync"
          onPress={() => router.push('/cloud-sync/setup' as never)}
        />
        <AppButton label="Sign Out" variant="secondary" onPress={confirmPlainSignOut} />
      </View>
    );
  }

  function LinkedActions() {
    const mismatch = sync.status === 'account_mismatch';
    const needsReconciliation = sync.status === 'reconciliation_required';
    return (
      <View style={styles.actions}>
        {mismatch ? (
          <AppText color={colors.danger}>
            Sync is paused. Sign out of this account, then sign in with the account this device is
            linked to.
          </AppText>
        ) : null}
        {needsReconciliation ? (
          <AppButton
            label="Review Sync Status"
            onPress={() => router.push('/cloud-sync/setup' as never)}
          />
        ) : (
          <AppButton
            label={sync.syncing ? 'Syncing…' : 'Sync Now'}
            disabled={sync.syncing || busy !== '' || !canSyncNow(sync.status)}
            onPress={runSyncNow}
          />
        )}
        <AppButton
          label={busy === 'sign-out' ? 'Signing out…' : 'Sign Out'}
          variant="secondary"
          disabled={busy !== '' || sync.syncing}
          onPress={confirmLinkedSignOut}
        />
      </View>
    );
  }

  async function runSyncNow() {
    if (sync.syncing || busy !== '') return;
    setError('');
    const result = await sync.syncNow();
    if (result === null) return;
    const message = describeSyncError(
      result.status === 'success' ? null : (result.status as string),
    );
    if (result.status !== 'success' && message !== null) setError(message);
  }

  function confirmPlainSignOut() {
    Alert.alert(
      'Sign out of your cloud account?',
      'This device has not been linked, so no financial data is affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => void performSignOut('keep') },
      ],
    );
  }

  /**
   * Signing out of a linked device is a data decision, not just an auth one, so
   * unsent work is surfaced first and the choice is made explicitly.
   */
  function confirmLinkedSignOut() {
    const warning =
      sync.pendingChanges > 0
        ? `${describePendingChanges(sync.pendingChanges, false)}. Those changes have not been uploaded yet.\n\n`
        : '';
    Alert.alert(
      'Sign out of cloud sync?',
      `${warning}Choose what happens to the financial data on this device. Your cloud data is not deleted either way.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep Data on This Device',
          onPress: () => void performSignOut('keep'),
        },
        {
          text: 'Remove From This Device',
          style: 'destructive',
          onPress: confirmRemoveLocalCopy,
        },
      ],
    );
  }

  function confirmRemoveLocalCopy() {
    Alert.alert(
      'Remove this device’s copy?',
      'This removes the local copy from this device. Your cloud data remains in your cloud account and can be downloaded again by signing in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void performSignOut('remove'),
        },
      ],
    );
  }

  async function performSignOut(mode: 'keep' | 'remove') {
    if (busy !== '') return;
    setBusy('sign-out');
    setError('');
    try {
      if (mode === 'remove') await removeCloudDataFromDevice();
      else await signOutKeepingLocalData();
      sync.refresh();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setBusy('');
    }
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText color={colors.textMuted}>{label}</AppText>
      <AppText weight="600">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { gap: spacing.sm },
  card: { gap: spacing.md },
  status: { gap: spacing.xs },
  actions: { gap: spacing.md },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
});
