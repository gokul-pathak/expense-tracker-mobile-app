import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  BottomSheet,
  Button,
  Card,
  Dialog,
  FormScreen,
  Icon,
  ListRow,
  SectionHeader,
  Text,
  type IconName,
} from '@/components/ui';
import { useCloudAuth } from '@/features/cloud-auth/auth.provider';
import { useCloudSync } from '@/features/sync/sync.provider';
import {
  describeLastSync,
  describePendingChanges,
  describeSyncError,
  describeSyncStatus,
} from '@/features/sync/sync-presentation';
import { canSyncNow, isCloudLinked, type CloudSyncStatus } from '@/features/sync/sync-status';
import { removeCloudDataFromDevice, signOutKeepingLocalData } from '@/features/sync/sync.service';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme, withAlpha } from '@/theme';

/**
 * Cloud Sync.
 *
 * Every state this screen shows is derived from durable facts on each render, so
 * it cannot claim a device is synchronized while changes are still queued. The
 * screen reads no cloud data of its own: financial figures live on the other
 * screens, from SQLite.
 */
export default function CloudSyncScreen() {
  const { palette, space } = useTheme();
  const { user, status: authStatus } = useCloudAuth();
  const sync = useCloudSync();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [confirmPlain, setConfirmPlain] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

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
  const problem = describeSyncError(sync.lastError);
  const tone = statusTone(sync.status);

  return (
    <FormScreen title="Cloud Sync">
      {error ? (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <Text variant="body" tone="secondary" style={{ marginTop: space.sm }}>
        Your financial data can be synchronized with your cloud account across devices. It is always
        stored on this device as well.
      </Text>

      <Card hero style={{ marginTop: space.lg }}>
        <View
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
          style={[styles.status, { gap: space.md + 2 }]}
        >
          <View
            style={[
              styles.badge,
              {
                borderRadius: 14,
                backgroundColor: withAlpha(palette[tone.color], 0.14),
              },
            ]}
          >
            <Icon name={tone.icon} size="row" color={palette[tone.color]} />
          </View>
          <View style={styles.statusText}>
            <Text variant="bodyStrong">{copy.title}</Text>
            <Text variant="small" tone="secondary" style={{ marginTop: 2 }}>
              {copy.description}
            </Text>
            {pending ? (
              <Text variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
                {pending}
              </Text>
            ) : null}
          </View>
        </View>

        {sync.status === 'unconfigured' ? null : (
          <View style={{ marginTop: space.xl, gap: space.sm }}>
            {linked ? (
              <LinkedActions />
            ) : authStatus === 'signed_in' ? (
              <UnlinkedActions />
            ) : (
              <SignedOutActions />
            )}
          </View>
        )}
      </Card>

      {linked ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Details" />
          <Card padding="none">
            <ListRow label="Cloud account" value={email} valueTone="primary" chevron={false} />
            <ListRow
              label="Last successful sync"
              value={describeLastSync(sync.lastSuccessfulSyncAt)}
              chevron={false}
            />
            <ListRow
              label="Changes waiting to upload"
              value={String(sync.pendingChanges)}
              chevron={false}
              last={problem === null}
            />
            {problem ? (
              <ListRow
                label="Last problem"
                value={problem}
                valueTone="negative"
                chevron={false}
                last
              />
            ) : null}
          </Card>
        </View>
      ) : null}

      <BottomSheet
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out of cloud sync?"
        doneLabel="Cancel"
      >
        <View style={{ gap: space.md }}>
          {sync.pendingChanges > 0 ? (
            <Banner
              tone="warning"
              message={
                describePendingChanges(sync.pendingChanges, false) +
                '. Those changes have not been uploaded yet.'
              }
            />
          ) : null}
          <Text variant="body" tone="secondary">
            Choose what happens to the financial data on this device. Your cloud data is not deleted
            either way.
          </Text>
          <View style={{ marginTop: space.sm, gap: space.sm }}>
            <Button
              label="Keep Data on This Device"
              onPress={() => {
                setSignOutOpen(false);
                void performSignOut('keep');
              }}
            />
            <Button
              label="Remove From This Device"
              variant="destructive"
              fullWidth
              onPress={() => {
                setSignOutOpen(false);
                setConfirmRemove(true);
              }}
            />
          </View>
        </View>
      </BottomSheet>

      <Dialog
        visible={confirmPlain}
        title="Sign out of your cloud account?"
        message="This device has not been linked, so no financial data is affected."
        confirmLabel="Sign Out"
        destructive
        loading={busy === 'sign-out'}
        onCancel={() => setConfirmPlain(false)}
        onConfirm={() => {
          setConfirmPlain(false);
          void performSignOut('keep');
        }}
      />

      <Dialog
        visible={confirmRemove}
        title="Remove this device's copy?"
        message="This removes the local copy from this device. Your cloud data remains in your cloud account and can be downloaded again by signing in."
        confirmLabel="Remove"
        destructive
        loading={busy === 'sign-out'}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void performSignOut('remove');
        }}
      />
    </FormScreen>
  );

  function SignedOutActions() {
    return (
      <>
        <Text variant="small" tone="secondary" style={{ marginBottom: space.sm }}>
          Sign in to sync with your other devices. You can keep using the app without an account.
        </Text>
        <Button label="Sign In" onPress={() => router.push('/cloud-sync/sign-in' as never)} />
        <Button
          label="Create Account"
          variant="secondary"
          onPress={() => router.push('/cloud-sync/sign-up' as never)}
        />
      </>
    );
  }

  function UnlinkedActions() {
    return (
      <>
        <Text variant="small" tone="secondary" style={{ marginBottom: space.sm }}>
          Signed in as {email}. This device is not linked yet.
        </Text>
        <Button
          label="Set Up Cloud Sync"
          onPress={() => router.push('/cloud-sync/setup' as never)}
        />
        <Button label="Sign Out" variant="secondary" onPress={() => setConfirmPlain(true)} />
      </>
    );
  }

  function LinkedActions() {
    const mismatch = sync.status === 'account_mismatch';
    const needsReconciliation = sync.status === 'reconciliation_required';
    return (
      <>
        {mismatch ? (
          <View style={{ marginBottom: space.sm }}>
            <Banner
              tone="negative"
              message="Sync is paused. Sign out of this account, then sign in with the account this device is linked to."
            />
          </View>
        ) : null}
        {needsReconciliation ? (
          <Button
            label="Review Sync Status"
            onPress={() => router.push('/cloud-sync/setup' as never)}
          />
        ) : (
          <Button
            label="Sync Now"
            loading={sync.syncing}
            disabled={sync.syncing || busy !== '' || !canSyncNow(sync.status)}
            onPress={() => void runSyncNow()}
          />
        )}
        <Button
          label="Sign Out"
          variant="secondary"
          loading={busy === 'sign-out'}
          disabled={busy !== '' || sync.syncing}
          onPress={() => setSignOutOpen(true)}
        />
      </>
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

/**
 * The badge colour is the fastest read on this screen, so it says only what the
 * status actually supports: green means a completed cycle and nothing less.
 */
function statusTone(status: CloudSyncStatus): {
  icon: IconName;
  color: 'positive' | 'negative' | 'warning' | 'textSecondary';
} {
  switch (status) {
    case 'synced':
      return { icon: 'cloud-check', color: 'positive' };
    case 'syncing':
    case 'linking':
      return { icon: 'refresh-cw', color: 'textSecondary' };
    case 'pending_changes':
      return { icon: 'cloud-upload', color: 'warning' };
    case 'offline':
      return { icon: 'cloud-off', color: 'warning' };
    case 'auth_required':
    case 'setup_required':
    case 'reconciliation_required':
      return { icon: 'triangle-alert', color: 'warning' };
    case 'attention_required':
    case 'account_mismatch':
    case 'error':
      return { icon: 'circle-alert', color: 'negative' };
    default:
      return { icon: 'cloud', color: 'textSecondary' };
  }
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'flex-start' },
  badge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  statusText: { flex: 1, minWidth: 0 },
});
