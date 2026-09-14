import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScreen,
  ListRow,
  Money,
  NativeDataNotice,
  Screen,
  SegmentedControl,
  Skeleton,
  StatTile,
  Text,
} from '@/components/ui';
import type { Person } from '@/features/people/person.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import type {
  PeopleFinancialSummaryByCurrency,
  PersonFinancialSummary,
} from '@/features/transactions/transaction.types';
import {
  getAppSettings,
  getPeopleFinancialSummaryByCurrency,
  isLocalFinanceDataAvailable,
  listActivePeople,
  listArchivedPeople,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

type Scope = 'active' | 'archived';

const scopes = [
  { value: 'active' as const, label: 'Active' },
  { value: 'archived' as const, label: 'Archived' },
];

export default function PeopleScreen() {
  const { palette, space, radius, size } = useTheme();
  const [scope, setScope] = useState<Scope>('active');
  const [people, setPeople] = useState<Person[]>([]);
  /**
   * What is owed, one entry per currency. Different people can be owed in
   * different currencies, and a single total would add rupees to dollars.
   */
  const [totals, setTotals] = useState<PeopleFinancialSummaryByCurrency[]>([]);
  const [currency, setCurrency] = useState('NPR');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setPeople(scope === 'active' ? listActivePeople() : listArchivedPeople());
      setTotals(getPeopleFinancialSummaryByCurrency());
      setCurrency(getAppSettings().defaultCurrency);
    } catch (error) {
      if (__DEV__) console.error('Could not load people.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  const settled = totals.every(
    (group) => group.totalReceivableMinor === 0 && group.totalLiabilityMinor === 0,
  );
  // Nobody has any debt history yet: one card of zeros in the default currency.
  const shownTotals: PeopleFinancialSummaryByCurrency[] =
    totals.length > 0
      ? totals
      : [{ currency, totalReceivableMinor: 0, totalLiabilityMinor: 0, people: [] }];
  const multipleCurrencies = shownTotals.length > 1;
  const summaryOf = new Map<number, { summary: PersonFinancialSummary; currency: string }>();
  for (const group of totals) {
    for (const summary of group.people) {
      summaryOf.set(summary.personId, { summary, currency: group.currency });
    }
  }

  return (
    <FormScreen
      title="People"
      footer={
        people.length > 0 && !loading && !failed ? (
          <Button
            label="Add Person"
            variant="text"
            icon="plus"
            fullWidth
            onPress={() => router.push('/people/new' as never)}
          />
        ) : undefined
      }
    >
      <View style={{ marginTop: space.sm }}>
        <SegmentedControl
          segments={scopes}
          value={scope}
          onChange={setScope}
          accessibilityLabel="Show active or archived people"
        />
      </View>

      {loading ? (
        <View>
          <Skeleton height={80} radius={radius.card} style={{ marginTop: space.lg }} />
          <Skeleton
            height={size.listRow * 4}
            radius={radius.card}
            style={{ marginTop: space.xxl }}
          />
        </View>
      ) : failed ? (
        <ErrorState
          message="Your local people records could not be read. Your data is safe."
          onRetry={load}
        />
      ) : (
        <>
          {scope === 'active'
            ? shownTotals.map((group) => (
                <Card key={group.currency} style={[styles.totals, { marginTop: space.lg }]}>
                  <StatTile
                    label={
                      multipleCurrencies
                        ? 'You will receive · ' + group.currency
                        : 'You will receive'
                    }
                    minorUnits={group.totalReceivableMinor}
                    currency={group.currency}
                    direction={group.totalReceivableMinor > 0 ? 'income' : undefined}
                    size="row"
                  />
                  <View style={[styles.divider, { backgroundColor: palette.divider }]} />
                  <StatTile
                    label={
                      multipleCurrencies ? 'You need to pay · ' + group.currency : 'You need to pay'
                    }
                    minorUnits={group.totalLiabilityMinor}
                    currency={group.currency}
                    direction={group.totalLiabilityMinor > 0 ? 'expense' : undefined}
                    size="row"
                    align="right"
                  />
                </Card>
              ))
            : null}

          {scope === 'active' && multipleCurrencies ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
              Each currency is totalled on its own. Nothing is converted.
            </Text>
          ) : null}

          {scope === 'active' && settled && people.length > 0 ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
              Nothing outstanding with anyone.
            </Text>
          ) : null}

          {people.length === 0 ? (
            <EmptyState
              illustration="arcs"
              title={scope === 'active' ? 'No people yet' : 'Nothing archived'}
              body={
                scope === 'active'
                  ? 'Add the people you lend to and borrow from. Every loan and repayment is tracked against one of them.'
                  : 'People you archive are kept here so their history stays intact.'
              }
              action={
                scope === 'active'
                  ? { label: 'Add Person', onPress: () => router.push('/people/new' as never) }
                  : undefined
              }
            />
          ) : (
            <Card padding="none" style={{ marginTop: space.lg }}>
              {people.map((person, index) => {
                const entry = summaryOf.get(person.id);
                return (
                  <PersonRow
                    key={person.id}
                    person={person}
                    summary={entry?.summary}
                    currency={entry?.currency ?? currency}
                    last={index === people.length - 1}
                  />
                );
              })}
            </Card>
          )}
        </>
      )}
    </FormScreen>
  );
}

/**
 * The right-hand figure says who owes whom, not just how much. A bare number
 * beside a name is ambiguous in exactly the situation this screen exists for.
 * It is in the currency that person's debts are kept in.
 */
function PersonRow({
  person,
  summary,
  currency,
  last,
}: {
  person: Person;
  summary?: PersonFinancialSummary;
  currency: string;
  last: boolean;
}) {
  const net = summary?.netMinor ?? 0;
  const detail = net > 0 ? 'Owes you' : net < 0 ? 'You owe' : (person.note ?? 'Settled');

  return (
    <ListRow
      label={person.name}
      detail={detail}
      icon="user"
      trailing={
        net === 0 ? undefined : (
          <Money
            minorUnits={Math.abs(net)}
            currency={currency}
            size="row"
            direction={net > 0 ? 'income' : 'expense'}
            showCode={false}
            align="right"
          />
        )
      }
      chevron={net === 0}
      onPress={() => router.push(`/people/${person.id}` as never)}
      accessibilityLabel={person.name + ', ' + detail}
      last={last}
    />
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
