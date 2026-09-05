import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import type { Person } from '@/features/people/person.types';
import {
  isLocalFinanceDataAvailable,
  listActivePeople,
  listArchivedPeople,
} from '@/features/ui/data';
export default function PeopleScreen() {
  const [archived, setArchived] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setPeople(archived ? listArchivedPeople() : listActivePeople());
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
        people.map((person) => (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${person.name}`}
            onPress={() => router.push(`/people/${person.id}` as never)}
          >
            <Card style={styles.row}>
              <View>
                <AppText weight="700">{person.name}</AppText>
                {person.note ? (
                  <AppText variant="caption" color={colors.textMuted}>
                    {person.note}
                  </AppText>
                ) : null}
              </View>
              <AppText color={colors.textMuted}>›</AppText>
            </Card>
          </Pressable>
        ))
      )}
      <AppButton label="+ Add Person" onPress={() => router.push('/people/new' as never)} />
    </Screen>
  );
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
});
