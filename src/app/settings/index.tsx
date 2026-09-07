import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
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

const currencies = ['NPR', 'USD', 'INR'] as const;

export default function SettingsScreen() {
  const [currency, setCurrency] = useState<string>();
  const [hasAccounts, setHasAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dataOperation, setDataOperation] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setError('');
    try {
      setCurrency(getAppSettings().defaultCurrency);
      setHasAccounts(listAccounts().length > 0);
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
              Alert.alert(
                'Backup restored',
                'Your local financial data has been replaced successfully.',
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
});
