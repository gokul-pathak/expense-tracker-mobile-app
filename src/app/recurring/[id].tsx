import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  CategoryChip,
  Dialog,
  EmptyState,
  ErrorState,
  FormScreen,
  ListRow,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import {
  describeRecurrence,
  formatScheduledLong,
  getHistoryEntryAccessibilityLabel,
  getHistoryEntryLabel,
  getNextDueLabel,
  getScheduleExplanation,
  getTemplateStatusLabel,
  recurringTypeDirection,
  recurringTypeLabel,
  templateLabel,
} from '@/features/recurring/recurring-presentation';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import type {
  OccurrenceHistoryItem,
  RecurringTemplateView,
} from '@/features/recurring/recurring.types';
import {
  countOutstandingOccurrences,
  deleteRecurringTemplate,
  isLocalFinanceDataAvailable,
  listRecurringTemplates,
  listTemplateHistory,
  pauseRecurringTemplate,
  resumeRecurringTemplate,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'ready'; view: RecurringTemplateView; history: OccurrenceHistoryItem[] };

export default function RecurringDetailScreen() {
  const { space } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parseRouteId(id);
  const asOfDate = localDateOf(new Date());

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resumeWarning, setResumeWarning] = useState<{ count: number; hasMore: boolean } | null>(
    null,
  );
  const acting = useRef(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setState({ kind: 'missing' });
      return;
    }
    try {
      const view = listRecurringTemplates().find((item) => item.id === routeId);
      if (view === undefined) {
        setState({ kind: 'missing' });
        return;
      }
      setState({ kind: 'ready', view, history: listTemplateHistory(routeId) });
    } catch (caught) {
      console.error('Could not load recurring transaction.', caught);
      setState({ kind: 'failed' });
    }
  }, [routeId]);
  useFocusEffect(load);
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (state.kind === 'loading') {
    return (
      <FormScreen title="Recurring">
        <DetailSkeleton />
      </FormScreen>
    );
  }
  if (state.kind === 'missing') {
    return (
      <FormScreen title="Recurring">
        <EmptyState
          illustration="ledger"
          title="This recurring transaction no longer exists"
          body="It may have been deleted on this or another device. Any transactions it already created remain."
          action={{ label: 'View Recurring', onPress: () => router.replace('/recurring' as never) }}
        />
      </FormScreen>
    );
  }
  if (state.kind === 'failed') {
    return (
      <FormScreen title="Recurring">
        <ErrorState
          title="Couldn’t load this recurring transaction"
          message="Your data is safe."
          onRetry={load}
        />
      </FormScreen>
    );
  }

  const { view, history } = state;
  const nextDue = getNextDueLabel(view, asOfDate);

  return (
    <FormScreen
      title="Recurring"
      action={{
        label: 'Edit',
        onPress: () => router.push(`/recurring/${view.id}/edit` as never),
      }}
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={[styles.hero, { marginTop: space.lg, gap: space.md }]}>
        <CategoryChip categoryIcon={view.categoryIcon} size={52} />
        <Money
          minorUnits={view.amountMinor}
          currency={view.currency}
          size="feature"
          direction={recurringTypeDirection(view.type)}
          align="center"
        />
        <Text variant="body" tone="secondary">
          {templateLabel(view)}
        </Text>
      </View>

      {view.isPaused ? (
        <View style={{ marginTop: space.lg }}>
          <Banner
            tone="info"
            icon="circle-dashed"
            message="Paused. This recurring transaction won’t be offered for generation until resumed."
          />
        </View>
      ) : null}

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Details" />
        <Card padding="none">
          {detailRows(view, asOfDate, nextDue).map((row, index, rows) => (
            <ListRow
              key={row.label}
              label={row.label}
              value={row.value}
              valueTone="primary"
              chevron={false}
              last={index === rows.length - 1}
            />
          ))}
        </Card>
        {getScheduleExplanation(view) ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
            {getScheduleExplanation(view)}
          </Text>
        ) : null}
      </View>

      {history.length > 0 ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="History" />
          <Card padding="none">
            {history.map((item, index) => (
              <ListRow
                key={item.occurrenceDate}
                label={getHistoryEntryLabel(item)}
                accessibilityLabel={getHistoryEntryAccessibilityLabel(item)}
                chevron={false}
                last={index === history.length - 1}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View style={[styles.actions, { marginTop: space.xl4, gap: space.sm }]}>
        <Button
          label={view.isPaused ? 'Resume' : 'Pause'}
          variant="secondary"
          icon={view.isPaused ? 'rotate-cw' : 'circle-dashed'}
          loading={busy}
          disabled={busy}
          onPress={view.isPaused ? beginResume : pause}
        />
        <Button
          label="Delete Recurring Transaction"
          variant="destructive"
          disabled={busy}
          onPress={() => setConfirmDelete(true)}
        />
      </View>

      <Dialog
        visible={confirmDelete}
        title="Delete this recurring transaction?"
        message="Future occurrences will stop. Transactions already created from it will remain."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />

      <Dialog
        visible={resumeWarning !== null}
        title="Resume this recurring transaction?"
        message={resumeMessage(resumeWarning)}
        confirmLabel="Resume"
        loading={busy}
        onCancel={() => setResumeWarning(null)}
        onConfirm={resume}
      />
    </FormScreen>
  );

  function pause() {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      pauseRecurringTemplate(view.id);
      load();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }

  function beginResume() {
    setError('');
    try {
      const outstanding = countOutstandingOccurrences(view.id, { asOfDate });
      if (outstanding.count > 0) {
        setResumeWarning(outstanding);
      } else {
        resume();
      }
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }

  function resume() {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      resumeRecurringTemplate(view.id);
      setResumeWarning(null);
      load();
    } catch (caught) {
      setResumeWarning(null);
      setError(getUserErrorMessage(caught));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }

  function remove() {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      deleteRecurringTemplate(view.id);
      setConfirmDelete(false);
      router.back();
    } catch (caught) {
      setConfirmDelete(false);
      setError(getUserErrorMessage(caught));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
}

function detailRows(
  view: RecurringTemplateView,
  asOfDate: string,
  nextDue: string | null,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Type', value: recurringTypeLabel(view.type) },
    {
      label: view.type === 'expense' ? 'Category' : 'Source',
      value: view.categoryName ?? 'Deleted category',
    },
    { label: 'Account', value: view.accountName ?? 'Unknown account' },
    { label: 'Schedule', value: describeRecurrence(view.frequency, view.interval) },
    { label: 'Starts', value: formatScheduledLong(view.startDate) },
    {
      label: 'Ends',
      value: view.endDate ? formatScheduledLong(view.endDate) : 'No end date',
    },
    { label: 'Status', value: getTemplateStatusLabel(view) },
  ];
  if (!view.isPaused && nextDue !== null) {
    rows.push({ label: 'Next', value: formatScheduledLong(view.nextDueDate as string) });
  }
  return rows;
}

function resumeMessage(warning: { count: number; hasMore: boolean } | null): string {
  if (warning === null || warning.count === 0) {
    return 'It will be offered for generation again from its next scheduled date.';
  }
  const count = warning.hasMore ? warning.count + '+' : String(warning.count);
  const dates = warning.count === 1 && !warning.hasMore ? 'date' : 'dates';
  return (
    count +
    ' past ' +
    dates +
    ' that passed while paused will become due again. You can generate or skip each one.'
  );
}

function DetailSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Skeleton width={52} height={52} radius={radius.control} style={styles.centred} />
      <Skeleton
        width={180}
        height={32}
        radius="pill"
        style={[styles.centred, { marginTop: space.md }]}
      />
      <View style={{ marginTop: space.xxl }}>
        <Skeleton width={70} height={12} radius="pill" style={{ marginBottom: space.md }} />
        <Skeleton height={size.listRow * 5} radius={radius.card} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center' },
  actions: { alignSelf: 'stretch' },
  centred: { alignSelf: 'center' },
});
