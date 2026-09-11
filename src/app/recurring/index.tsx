import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  NativeDataNotice,
  NavBar,
  Screen,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { RecurringTemplateRow } from '@/features/recurring/RecurringTemplateRow';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import type { RecurringTemplateView } from '@/features/recurring/recurring.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  getRecurringHomeSummary,
  isLocalFinanceDataAvailable,
  listRecurringTemplates,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

type Loaded = {
  active: RecurringTemplateView[];
  paused: RecurringTemplateView[];
  dueCount: number;
  dueHasMore: boolean;
};

export default function RecurringScreen() {
  const { space, palette, gutter } = useTheme();
  const [asOfDate] = useState(() => localDateOf(new Date()));
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      const views = listRecurringTemplates();
      const summary = getRecurringHomeSummary({ asOfDate, previewLimit: 0 });
      setLoaded({
        active: views.filter((view) => !view.isPaused),
        paused: views.filter((view) => view.isPaused),
        dueCount: summary.dueCount,
        dueHasMore: summary.hasMore,
      });
    } catch (error) {
      console.error('Could not load recurring transactions.', error);
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

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar
        title="Recurring"
        onBack={() => router.back()}
        action={
          loaded && (loaded.active.length > 0 || loaded.paused.length > 0)
            ? { label: 'Add', onPress: () => router.push('/recurring/new' as never) }
            : undefined
        }
      />
      {failed ? (
        <View style={{ flex: 1, paddingHorizontal: gutter }}>
          <ErrorState
            title="Couldn’t load recurring transactions"
            message="Your data is safe."
            onRetry={load}
          />
        </View>
      ) : loaded === undefined ? (
        <View style={{ flex: 1, paddingHorizontal: gutter }}>
          <ListSkeleton />
        </View>
      ) : loaded.active.length === 0 && loaded.paused.length === 0 ? (
        <View style={{ flex: 1, paddingHorizontal: gutter }}>
          <EmptyState
            illustration="ledger"
            title="No recurring transactions yet"
            body="Set up income or expenses you handle regularly, like rent or a salary, and handle each one when it is due."
            action={{
              label: 'Add Recurring Transaction',
              onPress: () => router.push('/recurring/new' as never),
            }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: space.md,
            paddingBottom: space.xl6,
          }}
          showsVerticalScrollIndicator={false}
        >
          {loaded.dueCount > 0 ? (
            <Card padding="none" style={{ marginBottom: space.xxl }}>
              <ListRow
                icon="clock"
                iconColor={palette.warning}
                label="Due now"
                detail="Scheduled dates waiting to be generated or skipped"
                value={dueValue(loaded)}
                valueTone="warning"
                onPress={() => router.push('/recurring/due' as never)}
                last
              />
            </Card>
          ) : null}

          {loaded.active.length > 0 ? (
            <View style={{ marginBottom: space.xxl }}>
              <SectionHeader title="Active" />
              <Card padding="none">
                {loaded.active.map((view, index) => (
                  <RecurringTemplateRow
                    key={view.id}
                    view={view}
                    asOfDate={asOfDate}
                    onPress={() => router.push(`/recurring/${view.id}` as never)}
                    last={index === loaded.active.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          {loaded.paused.length > 0 ? (
            <View>
              <SectionHeader title="Paused" />
              <Card padding="none">
                {loaded.paused.map((view, index) => (
                  <RecurringTemplateRow
                    key={view.id}
                    view={view}
                    asOfDate={asOfDate}
                    onPress={() => router.push(`/recurring/${view.id}` as never)}
                    last={index === loaded.paused.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function dueValue(loaded: Loaded): string {
  const shown = loaded.dueHasMore ? loaded.dueCount + '+' : String(loaded.dueCount);
  return loaded.dueCount === 1 && !loaded.dueHasMore ? '1 due' : shown + ' due';
}

function ListSkeleton() {
  const { space, radius } = useTheme();
  return (
    <View style={{ marginTop: space.lg, gap: space.md }}>
      <Skeleton height={64} radius={radius.card} />
      <Skeleton width={70} height={12} radius="pill" style={{ marginTop: space.md }} />
      <Skeleton height={68 * 3} radius={radius.card} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
