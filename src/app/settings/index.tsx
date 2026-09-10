import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  BottomSheet,
  Button,
  Card,
  Dialog,
  ErrorState,
  FormScreen,
  ListRow,
  NativeDataNotice,
  PickerSheet,
  Screen,
  SectionHeader,
  Skeleton,
  Switch,
  Text,
  TextField,
  useToast,
  type PickerOption,
} from '@/components/ui';
import {
  changePin,
  disableAppLock,
  disableBiometrics,
  enableAppLock,
  enableBiometrics,
  getLockConfig,
  setAutoLockMs,
} from '@/features/security/app-lock.service';
import {
  AUTO_LOCK_OPTIONS,
  type AuthenticationResult,
  type AutoLockTimeout,
  type LockConfig,
} from '@/features/security/app-lock.types';
import { useCloudSync } from '@/features/sync/sync.provider';
import { isCloudLinked } from '@/features/sync/sync-status';
import {
  chooseBackup,
  createAndShareBackup,
  getAppSettings,
  isLocalFinanceDataAvailable,
  restoreChosenBackup,
  shareFullDataJson,
  shareTransactionsCsv,
  shareTransactionsJson,
  updateDefaultCurrency,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme, type ThemePreference } from '@/theme';

type PinMode = 'enable' | 'change' | 'disable';
type Picker = 'currency' | 'theme' | 'autoLock' | null;
type RestorePrompt = { text: string; message: string };

const currencies: PickerOption<string>[] = [
  { value: 'NPR', label: 'Nepalese Rupee', detail: 'NPR' },
  { value: 'INR', label: 'Indian Rupee', detail: 'INR' },
  { value: 'USD', label: 'US Dollar', detail: 'USD' },
];

const themes: PickerOption<ThemePreference>[] = [
  { value: 'system', label: 'System', detail: 'Follow your device', icon: 'smartphone' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
];

export default function SettingsScreen() {
  const { space, radius, size, preference, setPreference } = useTheme();
  const toast = useToast();
  const sync = useCloudSync();

  const [currency, setCurrency] = useState<string>();
  const [lock, setLock] = useState<LockConfig>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<Picker>(null);
  const [pinMode, setPinMode] = useState<PinMode>();
  const [busy, setBusy] = useState('');
  const [restorePrompt, setRestorePrompt] = useState<RestorePrompt>();

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setError('');
    try {
      setCurrency(getAppSettings().defaultCurrency);
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setLoading(false);
    }
    void getLockConfig()
      .then(setLock)
      .catch(() => setLock(undefined));
  }, []);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (loading) {
    return (
      <FormScreen title="Settings">
        {[0, 1, 2].map((group) => (
          <View key={group} style={{ marginTop: space.xxl }}>
            <Skeleton width={110} height={12} radius="pill" style={{ marginBottom: space.md }} />
            <Skeleton height={size.listRow * 2} radius={radius.card} />
          </View>
        ))}
      </FormScreen>
    );
  }
  if (!currency) {
    return (
      <FormScreen title="Settings">
        <ErrorState
          title="Could not load settings"
          message={error || 'Your local settings could not be read.'}
          onRetry={load}
        />
      </FormScreen>
    );
  }

  const linked = isCloudLinked(sync.status);

  return (
    <FormScreen title="Settings">
      {error ? (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={{ marginTop: space.lg }}>
        <SectionHeader title="Preferences" />
        <Card padding="none">
          <ListRow
            icon="coins"
            label="Default Currency"
            value={currency}
            onPress={() => setPicker('currency')}
          />
          <ListRow
            icon="moon"
            label="Theme"
            value={themeLabel(preference)}
            onPress={() => setPicker('theme')}
            last
          />
        </Card>
        <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
          Changing the default currency does not convert amounts you have already recorded.
        </Text>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Privacy & Security" />
        <Card padding="none">
          <ListRow
            icon="lock"
            label="App Lock"
            detail={lock?.enabled ? undefined : 'A PIN is asked for when you open the app'}
            chevron={false}
            trailing={
              <Switch
                value={lock?.enabled ?? false}
                disabled={lock === undefined || busy !== ''}
                accessibilityLabel="App Lock"
                onValueChange={(next) => setPinMode(next ? 'enable' : 'disable')}
              />
            }
            last={!lock?.enabled}
          />
          {lock?.enabled ? (
            <>
              <ListRow
                icon="scan-face"
                label="Biometrics"
                chevron={false}
                trailing={
                  <Switch
                    value={lock.biometricEnabled}
                    disabled={busy !== ''}
                    accessibilityLabel="Biometrics"
                    onValueChange={toggleBiometrics}
                  />
                }
              />
              <ListRow
                icon="clock"
                label="Auto-Lock"
                value={autoLockLabel(lock.autoLockMs)}
                onPress={() => setPicker('autoLock')}
              />
              <ListRow
                icon="key-round"
                label="Change PIN"
                onPress={() => setPinMode('change')}
                last
              />
            </>
          ) : null}
        </Card>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Cloud Sync" />
        <Card padding="none">
          <ListRow
            icon={linked ? 'cloud-check' : 'cloud'}
            label="Cloud Sync"
            value={linked ? 'Linked' : 'Off'}
            valueTone={linked ? 'positive' : 'tertiary'}
            chevron={false}
            onPress={() => router.push('/cloud-sync' as never)}
            last
          />
        </Card>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Export" />
        <Card padding="none">
          <ListRow
            icon="file-spreadsheet"
            label="Transactions as CSV"
            onPress={() => run('csv', shareTransactionsCsv)}
            disabled={busy !== ''}
          />
          <ListRow
            icon="file-json"
            label="Transactions as JSON"
            onPress={() => run('json', shareTransactionsJson)}
            disabled={busy !== ''}
          />
          <ListRow
            icon="database"
            label="Everything as JSON"
            onPress={() => run('full', shareFullDataJson)}
            disabled={busy !== ''}
            last
          />
        </Card>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Backup & Restore" />
        {linked ? (
          <View style={{ marginBottom: space.md }}>
            <Banner
              tone="warning"
              message="Restoring a backup unlinks this device from cloud sync. You choose which copy to keep afterwards."
            />
          </View>
        ) : null}
        <Card padding="none">
          <ListRow
            icon="download"
            label="Create Backup"
            onPress={() => run('backup', createAndShareBackup)}
            disabled={busy !== ''}
          />
          <ListRow
            icon="rotate-ccw"
            label="Restore Backup"
            onPress={pickBackup}
            disabled={busy !== ''}
            last
          />
        </Card>
      </View>

      <PickerSheet
        visible={picker === 'currency'}
        onClose={() => setPicker(null)}
        title="Default currency"
        options={currencies}
        selected={currency}
        onSelect={saveCurrency}
      />
      <PickerSheet
        visible={picker === 'theme'}
        onClose={() => setPicker(null)}
        title="Theme"
        options={themes}
        selected={preference}
        onSelect={setPreference}
      />
      <PickerSheet
        visible={picker === 'autoLock'}
        onClose={() => setPicker(null)}
        title="Lock after"
        options={AUTO_LOCK_OPTIONS.map((value) => ({
          value,
          label: autoLockLabel(value),
        }))}
        selected={lock?.autoLockMs}
        onSelect={saveAutoLock}
      />

      <PinSheet
        mode={pinMode}
        busy={busy === 'pin'}
        onClose={() => setPinMode(undefined)}
        onSubmit={submitPin}
      />

      <Dialog
        visible={restorePrompt !== undefined}
        title="Restore this backup?"
        message={restorePrompt?.message ?? ''}
        confirmLabel="Restore"
        destructive
        loading={busy === 'restore'}
        onCancel={() => setRestorePrompt(undefined)}
        onConfirm={restore}
      />
    </FormScreen>
  );

  function saveCurrency(next: string) {
    setError('');
    try {
      setCurrency(updateDefaultCurrency(next).defaultCurrency);
      toast.show({ message: 'Default currency set to ' + next });
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }

  function saveAutoLock(next: AutoLockTimeout) {
    setError('');
    void setAutoLockMs(next)
      .then(getLockConfig)
      .then(setLock)
      .catch((caught: unknown) => setError(getUserErrorMessage(caught)));
  }

  function toggleBiometrics(next: boolean) {
    setError('');
    setBusy('biometrics');
    const action = next
      ? enableBiometrics().then((result) => {
          if (result.status !== 'success') {
            throw new Error(
              result.status === 'biometric_unavailable'
                ? 'This device has no biometrics set up.'
                : 'Biometric authentication did not complete.',
            );
          }
        })
      : disableBiometrics();
    void action
      .then(getLockConfig)
      .then(setLock)
      .catch((caught: unknown) => setError(getUserErrorMessage(caught)))
      .finally(() => setBusy(''));
  }

  /**
   * Enabling, changing and disabling the lock all take a PIN, so they share one
   * sheet and differ only in which fields it asks for.
   */
  function submitPin(mode: PinMode, values: { current: string; next: string }) {
    setError('');
    setBusy('pin');
    const action =
      mode === 'enable'
        ? enableAppLock(values.next)
        : mode === 'change'
          ? changePin(values.current, values.next).then(assertAuthenticated)
          : disableAppLock(values.current).then(assertAuthenticated);

    void action
      .then(getLockConfig)
      .then((config) => {
        setLock(config);
        setPinMode(undefined);
        toast.show({
          message:
            mode === 'enable'
              ? 'App Lock is on'
              : mode === 'change'
                ? 'PIN changed'
                : 'App Lock is off',
        });
      })
      .catch((caught: unknown) => setError(getUserErrorMessage(caught)))
      .finally(() => setBusy(''));
  }

  function run(key: string, action: () => Promise<void>) {
    setError('');
    setBusy(key);
    void action()
      .catch((caught: unknown) => setError(getUserErrorMessage(caught)))
      .finally(() => setBusy(''));
  }

  function pickBackup() {
    setError('');
    setBusy('choose');
    void chooseBackup()
      .then((chosen) => {
        if (!chosen) return;
        const { preview } = chosen;
        setRestorePrompt({
          text: chosen.text,
          message:
            'Taken ' +
            new Date(preview.createdAt).toLocaleString() +
            ' · ' +
            preview.accounts +
            ' accounts, ' +
            preview.transactions +
            ' transactions, ' +
            preview.people +
            ' people, in ' +
            preview.currency +
            '. Everything currently on this device is replaced.',
        });
      })
      .catch((caught: unknown) => setError(getUserErrorMessage(caught)))
      .finally(() => setBusy(''));
  }

  function restore() {
    const prompt = restorePrompt;
    if (!prompt) return;
    setBusy('restore');
    try {
      restoreChosenBackup(prompt.text);
      setRestorePrompt(undefined);
      load();
      sync.refresh();
      toast.show({
        message: linked
          ? 'Restored. This device is no longer linked to cloud sync.'
          : 'Backup restored.',
        duration: 5000,
      });
    } catch (caught) {
      console.error('Backup restore failed', caught);
      setRestorePrompt(undefined);
      setError('Backup could not be restored. Your existing data was not changed.');
    } finally {
      setBusy('');
    }
  }
}

/** One sheet for all three PIN operations, asking only for the fields each needs. */
function PinSheet({
  mode,
  busy,
  onClose,
  onSubmit,
}: {
  mode?: PinMode;
  busy: boolean;
  onClose: () => void;
  onSubmit: (mode: PinMode, values: { current: string; next: string }) => void;
}) {
  const { space } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const needsCurrent = mode === 'change' || mode === 'disable';
  const needsNew = mode === 'enable' || mode === 'change';
  const title =
    mode === 'enable' ? 'Set a PIN' : mode === 'change' ? 'Change your PIN' : 'Turn off App Lock';

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setMismatch(false);
  };

  return (
    <BottomSheet
      visible={mode !== undefined}
      onClose={() => {
        reset();
        onClose();
      }}
      title={title}
      doneLabel="Cancel"
    >
      <View style={{ gap: space.lg }}>
        {needsCurrent ? (
          <TextField
            label="Current PIN"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
          />
        ) : null}
        {needsNew ? (
          <>
            <TextField
              label={mode === 'change' ? 'New PIN' : 'PIN'}
              value={next}
              onChangeText={setNext}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
            />
            <TextField
              label="Confirm PIN"
              value={confirm}
              onChangeText={(value) => {
                setConfirm(value);
                setMismatch(false);
              }}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
              error={mismatch ? 'PIN entries do not match.' : undefined}
            />
            <Text variant="caption" tone="tertiary">
              Four to eight digits. The PIN is stored on this device only and never synced.
            </Text>
          </>
        ) : null}
        <Button
          label={mode === 'disable' ? 'Turn Off' : 'Save PIN'}
          large
          loading={busy}
          onPress={() => {
            if (!mode) return;
            if (needsNew && next !== confirm) {
              setMismatch(true);
              return;
            }
            onSubmit(mode, { current, next });
            reset();
          }}
        />
      </View>
    </BottomSheet>
  );
}

/**
 * The service reports a refused attempt as a result rather than throwing, so
 * the refusal has to be turned into an error here for the promise chain to
 * treat it as a failure rather than a success.
 */
function assertAuthenticated(result: AuthenticationResult) {
  if (result.status === 'success') return;
  if (result.status === 'invalid_pin') throw new Error('That PIN is not correct.');
  if (result.status === 'rate_limited') {
    throw new Error(
      'Too many attempts. Try again in ' + Math.ceil(result.retryAfterMs / 1000) + ' seconds.',
    );
  }
  throw new Error('That did not complete. Try again.');
}

function themeLabel(preference: ThemePreference) {
  return preference === 'system' ? 'System' : preference === 'dark' ? 'Dark' : 'Light';
}

function autoLockLabel(ms: number) {
  if (ms === 0) return 'Immediately';
  const minutes = Math.round(ms / 60_000);
  return minutes === 1 ? 'After 1 minute' : 'After ' + minutes + ' minutes';
}
