import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import {
  getAppSettings,
  isLocalFinanceDataAvailable,
  listAccounts,
  updateDefaultCurrency,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';

const currencies = ['NPR', 'USD', 'INR'] as const;

export default function SettingsScreen() {
  const [currency, setCurrency] = useState<string>();
  const [hasAccounts, setHasAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      <AppButton label={saving ? 'Saving...' : 'Save Settings'} disabled={saving} onPress={save} />
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
