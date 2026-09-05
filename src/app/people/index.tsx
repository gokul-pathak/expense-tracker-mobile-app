import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import { formatMinorUnits } from '@/utils/money';
import type { Person } from '@/features/people/person.types';
import type { PersonFinancialSummary } from '@/features/transactions/transaction.types';
import {
  getPeopleFinancialSummary,
  isLocalFinanceDataAvailable,
  listActivePeople,
  listArchivedPeople,
} from '@/features/ui/data';
export default function PeopleScreen() {
  const [archived, setArchived] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [summaries, setSummaries] = useState<PersonFinancialSummary[]>([]);
  const [totalReceivableMinor, setTotalReceivableMinor] = useState(0);
  const [totalLiabilityMinor, setTotalLiabilityMinor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setPeople(archived ? listArchivedPeople() : listActivePeople());
      const financialSummary = getPeopleFinancialSummary();
      setSummaries(financialSummary.people);
      setTotalReceivableMinor(financialSummary.totalReceivableMinor);
      setTotalLiabilityMinor(financialSummary.totalLiabilityMinor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [archived]);
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
        <ScreenState title="Loading people" description="Reading your local people..." />
      </Screen>
    );
  if (failed)
    return (
      <Screen>
        <ScreenState
          title="Could not load people"
          description="Your local data could not be read."
          retry={load}
        />
      </Screen>
    );
  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="title" weight="700">
        People
      </AppText>
      <View style={styles.segment}>
        <Tab label="Active" selected={!archived} onPress={() => setArchived(false)} />
        <Tab label="Archived" selected={archived} onPress={() => setArchived(true)} />
      </View>
      {!archived ? (
        <View style={styles.summary}>
          <Card style={styles.summaryCard}>
            <AppText variant="caption" color={colors.textMuted}>
              You Will Receive
            </AppText>
            <AppText weight="700">{formatMinorUnits(totalReceivableMinor, 'NPR')}</AppText>
          </Card>
          <Card style={styles.summaryCard}>
            <AppText variant="caption" color={colors.textMuted}>
              You Need To Pay
            </AppText>
            <AppText weight="700">{formatMinorUnits(totalLiabilityMinor, 'NPR')}</AppText>
          </Card>
        </View>
      ) : null}
      {!archived && people.length > 0 && totalReceivableMinor === 0 && totalLiabilityMinor === 0 ? (
        <AppText color={colors.textMuted}>No outstanding money with people yet.</AppText>
      ) : null}
      {people.length === 0 ? (
        <ScreenState
          title={archived ? 'No archived people.' : 'No people added yet.'}
          description={
            archived
              ? 'Archived people will appear here.'
              : 'Add someone now so they can be used later when tracking money given or taken.'
          }
        />
      ) : (
        people.map((person) => {
          const summary = summaries.find((item) => item.personId === person.id);
          return (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={personAccessibilityLabel(person, summary)}
              onPress={() => router.push(`/people/${person.id}` as never)}
            >
              <Card style={styles.row}>
                <View>
                  <AppText weight="700">{person.name}</AppText>
                  {summary && (summary.receivableMinor > 0 || summary.liabilityMinor > 0) ? (
                    <FinancialState summary={summary} />
                  ) : person.note ? (
                    <AppText variant="caption" color={colors.textMuted}>
                      {person.note}
                    </AppText>
                  ) : null}
                </View>
                <AppText color={colors.textMuted}>›</AppText>
              </Card>
            </Pressable>
          );
        })
      )}
      <AppButton label="+ Add Person" onPress={() => router.push('/people/new' as never)} />
    </Screen>
  );
}
function FinancialState({ summary }: { summary: PersonFinancialSummary }) {
  return (
    <View>
      {summary.receivableMinor > 0 ? (
        <AppText variant="caption" color={colors.textMuted}>
          You will receive {formatMinorUnits(summary.receivableMinor, 'NPR')}
        </AppText>
      ) : null}
      {summary.liabilityMinor > 0 ? (
        <AppText variant="caption" color={colors.textMuted}>
          You need to pay {formatMinorUnits(summary.liabilityMinor, 'NPR')}
        </AppText>
      ) : null}
    </View>
  );
}
function personAccessibilityLabel(person: Person, summary?: PersonFinancialSummary) {
  if (summary?.receivableMinor)
    return `${person.name} owes you ${summary.receivableMinor} minor units`;
  if (summary?.liabilityMinor)
    return `You owe ${person.name} ${summary.liabilityMinor} minor units`;
  return `${person.name}, settled`;
}
function Tab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.selected]}
    >
      <AppText weight="600" color={selected ? colors.surface : colors.textMuted}>
        {label}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  segment: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  selected: { backgroundColor: colors.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summary: { flexDirection: 'row', gap: spacing.sm },
  summaryCard: { flex: 1, gap: spacing.xs },
});
