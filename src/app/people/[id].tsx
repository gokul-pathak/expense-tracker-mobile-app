import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorState,
  FormScreen,
  Icon,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
  Timeline,
  type TimelineEntry,
} from '@/components/ui';
import { PersonForm, type PersonFormValues } from '@/features/people/PersonForm';
import type { Person } from '@/features/people/person.types';
import { formatTransactionDate } from '@/features/transactions/transaction-presentation';
import type {
  PersonFinancialSummary,
  PersonTransactionItem,
} from '@/features/transactions/transaction.types';
import {
  archivePerson,
  getAppSettings,
  getPerson,
  getPersonFinancialSummary,
  getPersonTransactionHistory,
  isLocalFinanceDataAvailable,
  unarchivePerson,
  updatePerson,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

export default function PersonDetailScreen() {
  const { palette, space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [person, setPerson] = useState<Person>();
  const [summary, setSummary] = useState<PersonFinancialSummary>();
  const [history, setHistory] = useState<PersonTransactionItem[]>([]);
  const [currency, setCurrency] = useState('NPR');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setError('This link is invalid.');
      return;
    }
    setError('');
    try {
      setPerson(getPerson(routeId));
      setSummary(getPersonFinancialSummary(routeId));
      setHistory(getPersonTransactionHistory(routeId));
      setCurrency(getAppSettings().defaultCurrency);
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }, [routeId]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (error && !person) {
    return (
      <FormScreen title="Person">
        <ErrorState
          title="Could not load person"
          message={error}
          onRetry={routeId === null ? undefined : load}
        />
      </FormScreen>
    );
  }
  if (!person || !summary) {
    return (
      <FormScreen title="Person">
        <Skeleton height={150} radius={radius.card} style={{ marginTop: space.lg }} />
        <Skeleton
          height={size.transactionRow * 2}
          radius={radius.card}
          style={{ marginTop: space.xxl }}
        />
      </FormScreen>
    );
  }

  const currentPerson = person;
  const currentSummary = summary;
  const owesYou = currentSummary.netMinor > 0;
  const youOwe = currentSummary.netMinor < 0;

  return (
    <FormScreen title={currentPerson.name}>
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      {currentPerson.isArchived ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner
            tone="info"
            message="This person is archived. Their history is kept, but they are hidden when recording new loans."
          />
        </View>
      ) : null}

      <Card hero style={{ marginTop: space.sm }}>
        <Text variant="eyebrow" tone={owesYou || youOwe ? 'accent' : 'tertiary'}>
          {statusLabel(currentSummary.status)}
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: space.md }}>
          {owesYou ? 'Owes you' : youOwe ? 'You owe' : 'Nothing outstanding'}
        </Text>
        <View style={{ marginTop: space.xs }}>
          <Money
            minorUnits={Math.abs(currentSummary.netMinor)}
            currency={currency}
            size="stat"
            direction={owesYou ? 'income' : youOwe ? 'expense' : 'neutral'}
          />
        </View>
        {owesYou || youOwe ? (
          <View style={{ marginTop: space.lg }}>
            <Button
              label={owesYou ? 'Record Payment' : 'Repay'}
              onPress={() =>
                router.push({
                  pathname: '/people/[id]/payment',
                  params: {
                    id: String(currentPerson.id),
                    type: owesYou ? 'received' : 'paid',
                    outstanding: String(
                      owesYou ? currentSummary.receivableMinor : currentSummary.liabilityMinor,
                    ),
                  },
                } as never)
              }
            />
          </View>
        ) : null}
      </Card>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="History" />
        {history.length === 0 ? (
          <Card>
            <Text variant="body" tone="secondary">
              Nothing recorded with {currentPerson.name} yet.
            </Text>
          </Card>
        ) : (
          <Card>
            <Timeline
              entries={history.map((item) => toEntry(item, currentPerson.name, currency))}
            />
          </Card>
        )}
      </View>

      <View style={{ marginTop: space.xxl }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit details"
          accessibilityState={{ expanded: editing }}
          onPress={() => setEditing((open) => !open)}
          style={({ pressed }) => [
            styles.disclosure,
            { minHeight: size.touchTarget, paddingHorizontal: space.lg },
            pressed && styles.pressed,
          ]}
        >
          <Text variant="smallStrong" tone="secondary">
            Edit details
          </Text>
          <Icon
            name={editing ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={palette.textTertiary}
          />
        </Pressable>
        {editing ? (
          <View style={{ marginTop: space.md }}>
            <PersonForm
              initialValues={{ name: currentPerson.name, note: currentPerson.note ?? '' }}
              saving={saving}
              onSave={save}
            />
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
        <Button
          label={currentPerson.isArchived ? 'Unarchive Person' : 'Archive Person'}
          variant={currentPerson.isArchived ? 'text' : 'destructive'}
          disabled={saving}
          onPress={() => (currentPerson.isArchived ? toggleArchive() : setConfirming(true))}
        />
      </View>

      <Dialog
        visible={confirming}
        title="Archive this person?"
        message="They are hidden when recording new loans and repayments. Everything already recorded with them is kept."
        confirmLabel="Archive"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          toggleArchive();
        }}
      />
    </FormScreen>
  );

  function save(values: PersonFormValues) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      setPerson(updatePerson(currentPerson.id, { ...values, note: values.note || null }));
      setEditing(false);
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function toggleArchive() {
    try {
      setPerson(
        currentPerson.isArchived
          ? unarchivePerson(currentPerson.id)
          : archivePerson(currentPerson.id),
      );
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }
}

/**
 * Each event is described from the user's side — "You gave", "Ram paid" — and
 * says which account it moved through. Both halves matter: who did what, and
 * where the money actually went.
 */
function toEntry(item: PersonTransactionItem, personName: string, currency: string): TimelineEntry {
  const outgoing = item.type === 'lend' || item.type === 'repayment_paid';
  const label =
    item.type === 'lend'
      ? 'You gave'
      : item.type === 'borrow'
        ? 'You took'
        : item.type === 'repayment_received'
          ? personName + ' paid'
          : 'You paid';
  const detail =
    formatTransactionDate(item.transactionDate) +
    ' · ' +
    (outgoing ? 'from ' : 'to ') +
    item.accountName;

  return {
    key: item.id,
    label,
    detail: item.note ? detail + ' · ' + item.note : detail,
    minorUnits: item.amountMinor,
    currency,
    direction: outgoing ? 'expense' : 'income',
  };
}

function statusLabel(status: PersonFinancialSummary['status']) {
  if (status === 'settled') return 'Settled';
  if (status === 'partially_paid') return 'Partly paid';
  return 'Pending';
}

const styles = StyleSheet.create({
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.7 },
});
