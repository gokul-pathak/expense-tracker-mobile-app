import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  NativeDataNotice,
  NavBar,
  Screen,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { DueOccurrenceRow } from '@/features/recurring/DueOccurrenceRow';
import {
  ALREADY_HANDLED_MESSAGE,
  describeGenerateDueResult,
  getGenerateAllConfirmation,
  getSkipConfirmationMessage,
  isAlreadyHandledError,
} from '@/features/recurring/recurring-presentation';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import type { DueRecurringOccurrence } from '@/features/recurring/recurring.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  generateDueOccurrences,
  generateOccurrence,
  isLocalFinanceDataAvailable,
  listDueOccurrences,
  skipOccurrence,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';

type Loaded = { occurrences: DueRecurringOccurrence[]; hasMore: boolean };

function keyOf(occurrence: DueRecurringOccurrence) {
  return occurrence.templateId + ':' + occurrence.occurrenceDate;
}

export default function DueRecurringScreen() {
  const { space, palette } = useTheme();
  const [asOfDate] = useState(() => localDateOf(new Date()));
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [skipTarget, setSkipTarget] = useState<DueRecurringOccurrence | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'positive'; message: string } | null>(null);
  const acting = useRef(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      setLoaded(listDueOccurrences({ asOfDate }));
    } catch (error) {
      console.error('Could not load due recurring transactions.', error);
      setLoaded(undefined);
      setFailed(true);
    }
  }, [asOfDate]);
  useFocusEffect(load);
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  const busy = busyKey !== null || generatingAll;
  const generatableCount =
    loaded?.occurrences.filter((item) => item.blockedReason === null).length ?? 0;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Due" onBack={() => router.back()} />
      {failed ? (
        <Body>
          <ErrorState
            title="Couldn’t load due transactions"
            message="Your data is safe."
            onRetry={load}
          />
        </Body>
      ) : loaded === undefined ? (
        <Body>
          <DueSkeleton />
        </Body>
      ) : (
        <FlatList
          data={loaded.occurrences}
          keyExtractor={keyOf}
          contentContainerStyle={{ padding: space.xl, paddingBottom: space.xl6, gap: space.md }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ gap: space.md, marginBottom: loaded.occurrences.length ? space.xs : 0 }}>
              {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
              {loaded.occurrences.length > 0 ? (
                <SectionHeader
                  title={dueCountLabel(loaded)}
                  trailing={
                    generatableCount > 1 ? (
                      <Button
                        label="Generate all"
                        variant="text"
                        small
                        disabled={busy}
                        onPress={() => setConfirmAll(true)}
                      />
                    ) : undefined
                  }
                />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              illustration="arcs"
              title="Nothing due right now"
              body="Recurring transactions appear here when a scheduled date arrives."
              fill={false}
            />
          }
          renderItem={({ item }) => (
            <Card>
              <DueOccurrenceRow
                occurrence={item}
                asOfDate={asOfDate}
                busy={busy && (busyKey === keyOf(item) || generatingAll)}
                onGenerate={() => generate(item)}
                onSkip={() => setSkipTarget(item)}
                onEdit={() => router.push(`/recurring/${item.templateId}/edit` as never)}
              />
            </Card>
          )}
        />
      )}

      <Dialog
        visible={confirmAll}
        title="Generate all due transactions?"
        message={getGenerateAllConfirmation(generatableCount)}
        confirmLabel="Generate"
        loading={generatingAll}
        onCancel={() => setConfirmAll(false)}
        onConfirm={generateAll}
      />

      <Dialog
        visible={skipTarget !== null}
        title="Skip this occurrence?"
        message={skipTarget ? getSkipConfirmationMessage(skipTarget) : ''}
        confirmLabel="Skip"
        loading={busyKey !== null}
        onCancel={() => setSkipTarget(null)}
        onConfirm={() => {
          if (skipTarget) skip(skipTarget);
        }}
      />
    </SafeAreaView>
  );

  function generate(occurrence: DueRecurringOccurrence) {
    if (acting.current) return;
    acting.current = true;
    setBusyKey(keyOf(occurrence));
    setNotice(null);
    try {
      generateOccurrence(occurrence.templateId, occurrence.occurrenceDate, { asOfDate });
      load();
    } catch (caught) {
      handleActionError(caught);
    } finally {
      acting.current = false;
      setBusyKey(null);
    }
  }

  function skip(occurrence: DueRecurringOccurrence) {
    if (acting.current) return;
    acting.current = true;
    setBusyKey(keyOf(occurrence));
    setNotice(null);
    try {
      skipOccurrence(occurrence.templateId, occurrence.occurrenceDate, { asOfDate });
      setSkipTarget(null);
      load();
    } catch (caught) {
      setSkipTarget(null);
      handleActionError(caught);
    } finally {
      acting.current = false;
      setBusyKey(null);
    }
  }

  function generateAll() {
    if (acting.current) return;
    acting.current = true;
    setGeneratingAll(true);
    setConfirmAll(false);
    setNotice(null);
    try {
      const result = generateDueOccurrences({ asOfDate });
      setNotice({ tone: 'positive', message: describeGenerateDueResult(result) });
      load();
    } catch (caught) {
      handleActionError(caught);
    } finally {
      acting.current = false;
      setGeneratingAll(false);
    }
  }

  function handleActionError(caught: unknown) {
    if (isAlreadyHandledError(caught)) {
      setNotice({ tone: 'info', message: ALREADY_HANDLED_MESSAGE });
      load();
      return;
    }
    console.error('Could not handle recurring occurrence.', caught);
    setNotice({ tone: 'info', message: getUserErrorMessage(caught) });
  }
}

function dueCountLabel(loaded: Loaded): string {
  const count = loaded.occurrences.length;
  const shown = loaded.hasMore ? count + '+' : String(count);
  return count === 1 && !loaded.hasMore ? '1 due' : shown + ' due';
}

function Body({ children }: { children: React.ReactNode }) {
  const { space } = useTheme();
  return <View style={{ flex: 1, paddingHorizontal: space.xl }}>{children}</View>;
}

function DueSkeleton() {
  const { space, radius } = useTheme();
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Skeleton width={80} height={12} radius="pill" />
      <Skeleton height={132} radius={radius.card} />
      <Skeleton height={132} radius={radius.card} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
