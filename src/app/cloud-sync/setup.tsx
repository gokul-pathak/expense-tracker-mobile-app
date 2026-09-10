import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Dialog, ErrorState, FormScreen, Text } from '@/components/ui';
import {
  inspectCloudLink,
  linkUsingCloudData,
  linkUsingLocalData,
  type CloudLinkInspection,
  type ReconciliationResult,
} from '@/features/sync/reconciliation.service';
import { useCloudSync } from '@/features/sync/sync.provider';
import {
  describeReconciliationFailure,
  describeUseCloudData,
  describeUseLocalData,
  SETUP_STEPS,
  type SetupStep,
} from '@/features/sync/sync-presentation';
import { useTheme } from '@/theme';

type Choice = 'use_local' | 'use_cloud';
type ChoiceCopy = { title: string; body: string; warning?: string; confirmLabel: string };

/**
 * First cloud link.
 *
 * The screen's only real job is to make sure nobody replaces financial records
 * without knowing it. It inspects both sides, names what each choice would do in
 * full sentences, and only then offers the button. Nothing here starts on its
 * own: setting up is always something the person chose.
 */
export default function CloudSyncSetupScreen() {
  const { palette, space } = useTheme();
  const sync = useCloudSync();
  const [inspection, setInspection] = useState<CloudLinkInspection>();
  // Setup opens straight into its inspection, so the first thing shown is what
  // is actually happening rather than an empty screen.
  const [step, setStep] = useState<SetupStep | undefined>('inspecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ choice: Choice; copy: ChoiceCopy }>();

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

  // No back control while linking: once the critical section starts there is no
  // safe cancel, so the screen must not offer one.
  if (step !== undefined) {
    return (
      <FormScreen title="Cloud Sync">
        <View style={[styles.working, { paddingVertical: space.xl6, gap: space.lg }]}>
          <ActivityIndicator color={palette.accent} />
          <Text variant="heading" align="center">
            Setting up cloud sync
          </Text>
          <Text variant="body" tone="secondary" align="center">
            {SETUP_STEPS[step]}
          </Text>
        </View>
      </FormScreen>
    );
  }

  if (inspection === undefined) {
    return (
      <FormScreen title="Cloud Sync" backIcon="x">
        <ErrorState
          title="Cloud sync setup"
          message={error || 'Your cloud account could not be checked.'}
          onRetry={() => {
            setStep('inspecting');
            void inspect();
          }}
        />
      </FormScreen>
    );
  }

  const localHasData = inspection.local.hasMeaningfulData;
  const cloudHasData = inspection.cloud.hasMeaningfulData;
  const useLocal = describeUseLocalData(cloudHasData);
  const useCloud = describeUseCloudData(localHasData);
  const bothHaveData = localHasData && cloudHasData;

  return (
    <FormScreen title="Set Up Cloud Sync" backIcon="x">
      <Text variant="body" tone="secondary" style={{ marginTop: space.sm }}>
        {summarize(inspection)}
      </Text>

      {error ? (
        <View style={{ marginTop: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      {bothHaveData ? (
        <View style={{ marginTop: space.lg }}>
          <Banner
            tone="warning"
            message="Both sides have records. They are not combined — you choose which one to keep, and the other is replaced. A backup of this device is saved first either way."
          />
        </View>
      ) : null}

      <View style={{ marginTop: space.xl, gap: space.md }}>
        {/* Both empty: nothing can be lost, so one plain action is enough. */}
        {!localHasData && !cloudHasData ? (
          <ChoiceCard
            copy={{
              title: 'Link This Device',
              body: 'Your financial data will sync with this cloud account from now on.',
              confirmLabel: 'Link This Device',
            }}
            onPress={() => void run('use_local')}
          />
        ) : null}

        {localHasData && !cloudHasData ? (
          <ChoiceCard copy={useLocal} onPress={() => choose('use_local', useLocal)} />
        ) : null}

        {!localHasData && cloudHasData ? (
          <ChoiceCard copy={useCloud} onPress={() => choose('use_cloud', useCloud)} />
        ) : null}

        {bothHaveData ? (
          <>
            <ChoiceCard copy={useLocal} onPress={() => choose('use_local', useLocal)} />
            <ChoiceCard copy={useCloud} onPress={() => choose('use_cloud', useCloud)} />
          </>
        ) : null}
      </View>

      <Dialog
        visible={pending !== undefined}
        title={pending?.copy.title ?? ''}
        message={pending ? pending.copy.body + '\n\n' + (pending.copy.warning ?? '') : ''}
        confirmLabel={pending?.copy.confirmLabel ?? 'Continue'}
        destructive
        onCancel={() => setPending(undefined)}
        onConfirm={() => {
          const choice = pending?.choice;
          setPending(undefined);
          if (choice) void run(choice);
        }}
      />
    </FormScreen>
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
  function choose(choice: Choice, copy: ChoiceCopy) {
    if (copy.warning === undefined) {
      void run(choice);
      return;
    }
    setPending({ choice, copy });
  }

  async function run(choice: Choice) {
    setError('');
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

/**
 * One card per outcome, each stating what it does before the button that does
 * it. The warning is part of the card rather than only the confirmation, so the
 * consequence is readable before anything is tapped.
 */
function ChoiceCard({ copy, onPress }: { copy: ChoiceCopy; onPress: () => void }) {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.sm }}>
      <Text variant="bodyStrong">{copy.title}</Text>
      <Text variant="small" tone="secondary">
        {copy.body}
      </Text>
      {copy.warning ? (
        <View style={{ marginTop: space.xs }}>
          <Banner tone="warning" message={copy.warning} />
        </View>
      ) : null}
      <View style={{ marginTop: space.md }}>
        <Button
          label={copy.confirmLabel}
          variant={copy.warning ? 'secondary' : 'primary'}
          onPress={onPress}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  working: { alignItems: 'center' },
});
