import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, Screen, ScreenState } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useCloudSync } from '@/features/sync/sync.provider';
import {
  inspectCloudLink,
  linkUsingCloudData,
  linkUsingLocalData,
  type CloudLinkInspection,
  type ReconciliationResult,
} from '@/features/sync/reconciliation.service';
import {
  describeReconciliationFailure,
  describeUseCloudData,
  describeUseLocalData,
  SETUP_STEPS,
  type SetupStep,
} from '@/features/sync/sync-presentation';

/**
 * First cloud link.
 *
 * The screen's only real job is to make sure nobody replaces financial records
 * without knowing it. It inspects both sides, names what each choice would do in
 * full sentences, and only then offers the button. Nothing here starts on its
 * own: setting up is always something the person chose.
 */
export default function CloudSyncSetupScreen() {
  const sync = useCloudSync();
  const [inspection, setInspection] = useState<CloudLinkInspection>();
  // Setup opens straight into its inspection, so the first thing shown is what
  // is actually happening rather than an empty screen.
  const [step, setStep] = useState<SetupStep | undefined>('inspecting');
  const [error, setError] = useState('');

  const inspect = useCallback(async () => {
    const result = await inspectCloudLink();
    if (result.status === 'ok') {
      setInspection(result.inspection);
      setError('');
    } else {
      setError(describeReconciliationFailure(result.reason));
    }
    setStep(undefined);
  }, []);

  // Arriving on this screen is the user's request to inspect, and coming back to
  // it should look again rather than trust a stale answer.
  useFocusEffect(
    useCallback(() => {
      void inspect();
    }, [inspect]),
  );

  if (step !== undefined) {
    return (
      <Screen>
        <ScreenState title="Setting up cloud sync" description={SETUP_STEPS[step]} />
      </Screen>
    );
  }

  if (inspection === undefined) {
    return (
      <Screen>
        <ScreenState
          title="Cloud sync setup"
          description={error || 'Checking what your cloud account contains…'}
          retry={() => {
            setStep('inspecting');
            void inspect();
          }}
        />
      </Screen>
    );
  }

  const localHasData = inspection.local.hasMeaningfulData;
  const cloudHasData = inspection.cloud.hasMeaningfulData;
  const useLocal = describeUseLocalData(cloudHasData);
  const useCloud = describeUseCloudData(localHasData);

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Set Up Cloud Sync
        </AppText>
        <AppText color={colors.textMuted}>{summarize(inspection)}</AppText>
      </View>

      {/* Both empty: nothing can be lost, so one plain action is enough. */}
      {!localHasData && !cloudHasData ? (
        <Card style={styles.card}>
          <AppText weight="700">Link This Device</AppText>
          <AppText color={colors.textMuted}>
            Your financial data will sync with this cloud account from now on.
          </AppText>
          <AppButton label="Link This Device" onPress={() => void run('use_local')} />
        </Card>
      ) : null}

      {localHasData && !cloudHasData ? (
        <Choice copy={useLocal} onPress={() => void confirm('use_local', useLocal)} />
      ) : null}

      {!localHasData && cloudHasData ? (
        <Choice copy={useCloud} onPress={() => void confirm('use_cloud', useCloud)} />
      ) : null}

      {localHasData && cloudHasData ? (
        <>
          <Card style={styles.card}>
            <AppText weight="700">This device and your cloud account both have data</AppText>
            <AppText color={colors.textMuted}>
              They are not combined. Choose which one to keep — the other copy is replaced. A backup
              of this device is saved first either way.
            </AppText>
          </Card>
          <Choice copy={useLocal} onPress={() => void confirm('use_local', useLocal)} />
          <Choice copy={useCloud} onPress={() => void confirm('use_cloud', useCloud)} />
        </>
      ) : null}

      {error ? (
        <AppText color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}

      <AppButton label="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );

  function summarize(current: CloudLinkInspection): string {
    const local = current.local.hasMeaningfulData
      ? `This device has ${current.local.accounts} accounts and ${current.local.transactions} transactions.`
      : 'This device has no financial records yet.';
    const cloud = current.cloud.hasMeaningfulData
      ? `Your cloud account has ${current.cloud.accounts} accounts and ${current.cloud.transactions} transactions.`
      : 'Your cloud account has no financial records yet.';
    return `${local} ${cloud}`;
  }

  /** A destructive choice is confirmed on its own, with the consequence restated. */
  async function confirm(
    choice: 'use_local' | 'use_cloud',
    copy: { title: string; body: string; warning?: string; confirmLabel: string },
  ) {
    if (copy.warning === undefined) {
      await run(choice);
      return;
    }
    Alert.alert(copy.title, `${copy.body}\n\n${copy.warning}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: copy.confirmLabel, style: 'destructive', onPress: () => void run(choice) },
    ]);
  }

  async function run(choice: 'use_local' | 'use_cloud') {
    setError('');
    // Once the critical section starts there is no safe cancel: it finishes or
    // it rolls back, so no cancel control is offered from here on.
    setStep(choice === 'use_local' ? 'uploading' : 'downloading');
    const result: ReconciliationResult =
      choice === 'use_local' ? await linkUsingLocalData() : await linkUsingCloudData();
    setStep('finishing');
    sync.refresh();
    setStep(undefined);

    if (result.status === 'linked') {
      router.back();
      return;
    }
    setError(describeReconciliationFailure(result.reason));
  }
}

function Choice({
  copy,
  onPress,
}: {
  copy: { title: string; body: string; warning?: string; confirmLabel: string };
  onPress: () => void;
}) {
  return (
    <Card style={styles.card}>
      <AppText weight="700">{copy.title}</AppText>
      <AppText color={colors.textMuted}>{copy.body}</AppText>
      {copy.warning ? <AppText color={colors.danger}>{copy.warning}</AppText> : null}
      <AppButton label={copy.confirmLabel} onPress={onPress} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { gap: spacing.sm },
  card: { gap: spacing.md },
});
