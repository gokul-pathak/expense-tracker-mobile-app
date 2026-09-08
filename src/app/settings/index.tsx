import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { useCloudSync } from '@/features/sync/sync.provider';
import { isCloudLinked } from '@/features/sync/sync-status';
import { colors, radii, spacing } from '@/constants/theme';
import {
  getAppSettings,
  isLocalFinanceDataAvailable,
  listAccounts,
  shareTransactionsCsv,
  shareTransactionsJson,
  shareFullDataJson,
  createAndShareBackup,
  chooseBackup,
  restoreChosenBackup,
  updateDefaultCurrency,
} from '@/features/ui/data';
import type { BackupPreview } from '@/features/backup/backup.types';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { AUTO_LOCK_OPTIONS, type LockConfig } from '@/features/security/app-lock.types';
import {
  changePin,
  disableAppLock,
  disableBiometrics,
  enableAppLock,
  enableBiometrics,
  getLockConfig,
  setAutoLockMs,
} from '@/features/security/app-lock.service';

const currencies = ['NPR', 'USD', 'INR'] as const;

export default function SettingsScreen() {
  const sync = useCloudSync();
  const cloudLinked = isCloudLinked(sync.status);
  const [currency, setCurrency] = useState<string>();
  const [hasAccounts, setHasAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dataOperation, setDataOperation] = useState('');
  const [error, setError] = useState('');
  const [lockConfig, setLockConfig] = useState<LockConfig>();
  const [securityMode, setSecurityMode] = useState<'enable' | 'change' | 'disable'>();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setError('');
    try {
      setCurrency(getAppSettings().defaultCurrency);
      setHasAccounts(listAccounts().length > 0);
      getLockConfig()
        .then(setLockConfig)
        .catch(() => setLockConfig(undefined));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);
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
        <ScreenState title="Loading settings" description="Reading your local settings..." />
      </Screen>
    );
  if (!currency)
    return (
      <Screen>
        <ScreenState
          title="Could not load settings"
          description={error || 'Your local settings could not be read.'}
          retry={load}
        />
      </Screen>
    );
  const currentCurrency = currency;
  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Settings
        </AppText>
        <AppText color={colors.textMuted}>Choose the default currency for new records.</AppText>
      </View>
      <Card style={styles.card}>
        <AppText weight="700">Default Currency</AppText>
        <View style={styles.options}>
          {currencies.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ selected: currentCurrency === item }}
              onPress={() => setCurrency(item)}
              style={[styles.option, currentCurrency === item && styles.selected]}
            >
              <AppText weight="600" color={currentCurrency === item ? colors.surface : colors.text}>
                {item}
              </AppText>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card style={styles.card}>
        <AppText weight="700">Privacy & Security</AppText>
        {!lockConfig?.enabled ? (
          <>
            <AppText color={colors.textMuted}>
              Set a 4 to 8 digit PIN to protect app access.
            </AppText>
            {securityMode === 'enable' ? (
              securityForm('Create App Lock', 'Enable App Lock')
            ) : (
              <AppButton
                label="Enable App Lock"
                disabled={securityBusy || Boolean(dataOperation)}
                onPress={() => beginSecurity('enable')}
              />
            )}
          </>
        ) : (
          <>
            <AppText color={colors.textMuted}>
              App Lock is on. It protects app access, not the SQLite file itself.
            </AppText>
            <AppText weight="600">Auto-Lock</AppText>
            <View style={styles.options}>
              {AUTO_LOCK_OPTIONS.map((timeout) => (
                <Pressable
                  key={timeout}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: lockConfig.autoLockMs === timeout }}
                  onPress={() => updateAutoLock(timeout)}
                  style={[styles.option, lockConfig.autoLockMs === timeout && styles.selected]}
                >
                  <AppText
                    weight="600"
                    color={lockConfig.autoLockMs === timeout ? colors.surface : colors.text}
                  >
                    {timeout === 0 ? 'Immediately' : `${timeout / 60_000} min`}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <AppButton
              label={lockConfig.biometricEnabled ? 'Disable Biometrics' : 'Enable Biometrics'}
              disabled={securityBusy}
              onPress={toggleBiometrics}
            />
            {securityMode === 'change' ? (
              securityForm('Change PIN', 'Save New PIN')
            ) : (
              <AppButton
                label="Change PIN"
                disabled={securityBusy}
                onPress={() => beginSecurity('change')}
              />
            )}
            {securityMode === 'disable' ? (
              securityForm('Disable App Lock', 'Disable App Lock')
            ) : (
              <AppButton
                label="Disable App Lock"
                disabled={securityBusy}
                onPress={() => beginSecurity('disable')}
              />
            )}
          </>
        )}
      </Card>
      {hasAccounts ? (
        <AppText color={colors.textMuted}>
          Changing the default currency does not convert existing account amounts.
        </AppText>
      ) : null}
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <AppButton
        label={saving ? 'Saving...' : 'Save Settings'}
        disabled={saving || Boolean(dataOperation)}
        onPress={save}
      />
      <Card style={styles.card}>
        <AppText weight="700">Cloud Sync</AppText>
        <AppText color={colors.textMuted}>
          Cloud sync is optional. Your financial data always stays on this device as well.
        </AppText>
        <AppButton label="Cloud Sync" onPress={() => router.push('/cloud-sync' as never)} />
      </Card>
      <Card style={styles.card}>
        <AppText weight="700">Data</AppText>
        <AppText color={colors.textMuted}>
          Exports are read-only and include archived history.
        </AppText>
        <AppButton
          label={dataOperation === 'csv' ? 'Exporting...' : 'Export Transactions (CSV)'}
          disabled={Boolean(dataOperation)}
          onPress={() => run('csv', shareTransactionsCsv)}
        />
        <AppButton
          label={dataOperation === 'json' ? 'Exporting...' : 'Export Transactions (JSON)'}
          disabled={Boolean(dataOperation)}
          onPress={() => run('json', shareTransactionsJson)}
        />
        <AppButton
          label={dataOperation === 'full' ? 'Exporting...' : 'Export All Data (JSON)'}
          disabled={Boolean(dataOperation)}
          onPress={() => run('full', shareFullDataJson)}
        />
      </Card>
      <Card style={styles.card}>
        <AppText weight="700">Backup & Restore</AppText>
        <AppText color={colors.textMuted}>
          Restore replaces all current local financial data. It does not merge backups.
        </AppText>
        {cloudLinked ? (
          <AppText color={colors.danger}>
            This device is linked to cloud sync. Restoring a backup unlinks it, and you will choose
            which copy to keep before syncing again. Nothing is uploaded automatically.
          </AppText>
        ) : null}
        <AppButton
          label={dataOperation === 'backup' ? 'Creating backup...' : 'Create Backup'}
          disabled={Boolean(dataOperation)}
          onPress={() => run('backup', createAndShareBackup)}
        />
        <AppButton
          label={dataOperation === 'restore' ? 'Restoring backup...' : 'Restore Backup'}
          disabled={Boolean(dataOperation)}
          onPress={startRestore}
        />
      </Card>
    </Screen>
  );
  function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      setCurrency(updateDefaultCurrency(currentCurrency).defaultCurrency);
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  function beginSecurity(mode: 'enable' | 'change' | 'disable') {
    setSecurityMode(mode);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError('');
  }
  function securityForm(title: string, submitLabel: string) {
    const needsCurrent = securityMode === 'change' || securityMode === 'disable';
    return (
      <View style={styles.securityForm}>
        <AppText weight="600">{title}</AppText>
        {needsCurrent ? (
          <TextInput
            value={currentPin}
            onChangeText={setCurrentPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
            autoComplete="off"
            placeholder="Current PIN"
            style={styles.pinInput}
          />
        ) : null}
        {securityMode !== 'disable' ? (
          <>
            <TextInput
              value={newPin}
              onChangeText={setNewPin}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
              autoComplete="off"
              placeholder="New PIN"
              style={styles.pinInput}
            />
            <TextInput
              value={confirmPin}
              onChangeText={setConfirmPin}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
              autoComplete="off"
              placeholder="Confirm PIN"
              style={styles.pinInput}
            />
          </>
        ) : null}
        <AppButton
          label={securityBusy ? 'Saving...' : submitLabel}
          disabled={securityBusy}
          onPress={submitSecurity}
        />
        <AppButton
          label="Cancel"
          disabled={securityBusy}
          onPress={() => setSecurityMode(undefined)}
        />
      </View>
    );
  }
  async function submitSecurity() {
    if (!securityMode) return;
    if (securityMode !== 'disable' && newPin !== confirmPin) {
      setError('PIN entries do not match.');
      return;
    }
    setSecurityBusy(true);
    setError('');
    try {
      if (securityMode === 'enable') await enableAppLock(newPin);
      else if (securityMode === 'change') {
        const result = await changePin(currentPin, newPin);
        if (result.status !== 'success')
          throw new Error(
            result.status === 'rate_limited'
              ? `Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`
              : 'Current PIN is incorrect.',
          );
      } else {
        const result = await disableAppLock(currentPin);
        if (result.status !== 'success')
          throw new Error(
            result.status === 'rate_limited'
              ? `Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`
              : 'Current PIN is incorrect.',
          );
      }
      setLockConfig(await getLockConfig());
      setSecurityMode(undefined);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSecurityBusy(false);
    }
  }
  async function toggleBiometrics() {
    if (!lockConfig) return;
    setSecurityBusy(true);
    setError('');
    try {
      if (lockConfig.biometricEnabled) await disableBiometrics();
      else {
        const result = await enableBiometrics();
        if (result.status !== 'success')
          throw new Error(
            result.status === 'cancelled'
              ? 'Biometric authentication was cancelled.'
              : 'Biometrics are unavailable.',
          );
      }
      setLockConfig(await getLockConfig());
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSecurityBusy(false);
    }
  }
  async function updateAutoLock(timeout: (typeof AUTO_LOCK_OPTIONS)[number]) {
    if (securityBusy) return;
    setSecurityBusy(true);
    try {
      await setAutoLockMs(timeout);
      setLockConfig(await getLockConfig());
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSecurityBusy(false);
    }
  }
  async function run(name: string, operation: () => Promise<unknown>) {
    if (dataOperation) return;
    setDataOperation(name);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setDataOperation('');
    }
  }
  async function startRestore() {
    if (dataOperation) return;
    setDataOperation('restore');
    setError('');
    let awaitingConfirmation = false;
    try {
      const selected = await chooseBackup();
      if (!selected) return;
      awaitingConfirmation = true;
      confirmRestore(selected.text, selected.preview);
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      if (!awaitingConfirmation) setDataOperation('');
    }
  }
  function confirmRestore(text: string, preview: BackupPreview) {
    Alert.alert(
      'Restore this backup?',
      `Backup date: ${new Date(preview.createdAt).toLocaleString()}\nAccounts: ${preview.accounts}\nTransactions: ${preview.transactions}\nPeople: ${preview.people}\nCurrency: ${preview.currency}\n\nYour current local data will be replaced with this backup.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setDataOperation('') },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            setDataOperation('restore');
            try {
              restoreChosenBackup(text);
              load();
              sync.refresh();
              Alert.alert(
                'Backup restored',
                cloudLinked
                  ? 'Your local financial data has been replaced. This device is no longer linked to cloud sync — open Cloud Sync to choose which copy to keep.'
                  : 'Your local financial data has been replaced successfully.',
              );
            } catch (caught) {
              setError('Backup could not be restored. Your existing data was not changed.');
              console.error('Backup restore failed', caught);
            } finally {
              setDataOperation('');
            }
          },
        },
      ],
      { onDismiss: () => setDataOperation('') },
    );
  }
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { gap: spacing.sm },
  card: { gap: spacing.md },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  securityForm: { gap: spacing.sm },
  pinInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
});
