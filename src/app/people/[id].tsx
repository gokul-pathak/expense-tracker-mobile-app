import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppText,
  Card,
  FormScreen,
  NativeDataNotice,
  Screen,
  ScreenState,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { PersonForm, type PersonFormValues } from '@/features/people/PersonForm';
import type { Person } from '@/features/people/person.types';
import type {
  PersonFinancialSummary,
  PersonTransactionItem,
} from '@/features/transactions/transaction.types';
import {
  archivePerson,
  getPersonFinancialSummary,
  getPersonTransactionHistory,
  getPerson,
  isLocalFinanceDataAvailable,
  unarchivePerson,
  updatePerson,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { formatTransactionDate } from '@/features/transactions/transaction-presentation';
import { formatMinorUnits } from '@/utils/money';
export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [person, setPerson] = useState<Person>();
  const [summary, setSummary] = useState<PersonFinancialSummary>();
  const [history, setHistory] = useState<PersonTransactionItem[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    try {
      setPerson(getPerson(Number(id)));
      setSummary(getPersonFinancialSummary(Number(id)));
      setHistory(getPersonTransactionHistory(Number(id)));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }, [id]);
  useFocusEffect(load);
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (error && !person)
    return (
      <Screen>
        <ScreenState
          title="Could not load person"
          description={error}
          retry={() => router.back()}
        />
      </Screen>
    );
  if (!person)
    return (
      <Screen>
        <ScreenState title="Loading person" description="Reading your local person..." />
      </Screen>
    );
  const currentPerson = person;
  return (
    <FormScreen title={currentPerson.name}>
      <View style={styles.content}>
        {error ? <AppText color={colors.danger}>{error}</AppText> : null}
        {summary ? (
          <Card style={styles.summary}>
            <AppText variant="caption" color={colors.textMuted}>
              {statusLabel(summary.status)}
            </AppText>
            {summary.receivableMinor > 0 ? (
              <SummaryLine label="You Will Receive" amount={summary.receivableMinor} />
            ) : null}
            {summary.liabilityMinor > 0 ? (
              <SummaryLine label="You Need To Pay" amount={summary.liabilityMinor} />
            ) : null}
            {summary.receivableMinor === 0 && summary.liabilityMinor === 0 ? (
              <AppText weight="700">Settled</AppText>
            ) : null}
          </Card>
        ) : null}
        {!currentPerson.isArchived && summary?.receivableMinor ? (
          <AppButton
            label="Record Payment"
            onPress={() =>
              router.push({
                pathname: '/people/[id]/payment',
                params: {
                  id: currentPerson.id,
                  type: 'received',
                  outstanding: summary.receivableMinor,
                },
              } as never)
            }
          />
        ) : null}
        {!currentPerson.isArchived && summary?.liabilityMinor ? (
          <AppButton
            label="Repay"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/people/[id]/payment',
                params: { id: currentPerson.id, type: 'paid', outstanding: summary.liabilityMinor },
              } as never)
            }
          />
        ) : null}
        {currentPerson.isArchived ? (
          <AppText color={colors.textMuted}>
            This person is archived. Their financial history remains available, but new entries are
            disabled.
          </AppText>
        ) : null}
        <AppText variant="heading" weight="700">
          History
        </AppText>
        {history.length === 0 ? (
          <AppText color={colors.textMuted}>No money history with this person yet.</AppText>
        ) : (
          history.map((item) => (
            <Card key={item.id} style={styles.historyRow}>
              <View>
                <AppText weight="700">{historyLabel(item.type, currentPerson.name)}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {item.accountName} · {formatTransactionDate(item.transactionDate)}
                </AppText>
                {item.note ? (
                  <AppText variant="caption" color={colors.textMuted}>
                    {item.note}
                  </AppText>
                ) : null}
              </View>
              <AppText weight="700">{formatMinorUnits(item.amountMinor, 'NPR')}</AppText>
            </Card>
          ))
        )}
        <AppText variant="heading" weight="700">
          Person Details
        </AppText>
        <PersonForm
          initialValues={{ name: currentPerson.name, note: currentPerson.note ?? '' }}
          saving={saving}
          onSave={save}
        />
        <AppButton
          label={currentPerson.isArchived ? 'Unarchive Person' : 'Archive Person'}
          variant="secondary"
          disabled={saving}
          onPress={toggleArchive}
        />
      </View>
    </FormScreen>
  );
  function save(values: PersonFormValues) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      setPerson(updatePerson(currentPerson.id, { ...values, note: values.note || null }));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  function toggleArchive() {
    const perform = () => {
      try {
        setPerson(
          currentPerson.isArchived
            ? unarchivePerson(currentPerson.id)
            : archivePerson(currentPerson.id),
        );
      } catch (caught) {
        setError(getUserErrorMessage(caught));
      }
    };
    if (currentPerson.isArchived) perform();
    else
      Alert.alert(
        'Archive this person?',
        'They will be hidden from active people but kept for historical records.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', style: 'destructive', onPress: perform },
        ],
      );
  }
}
function SummaryLine({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.summaryLine}>
      <AppText color={colors.textMuted}>{label}</AppText>
      <AppText weight="700">{formatMinorUnits(amount, 'NPR')}</AppText>
    </View>
  );
}
function statusLabel(status: PersonFinancialSummary['status']) {
  return status === 'partially_paid'
    ? 'Partially Paid'
    : status === 'pending'
      ? 'Pending'
      : 'Settled';
}
function historyLabel(type: PersonTransactionItem['type'], name: string) {
  if (type === 'lend') return 'You gave';
  if (type === 'borrow') return 'You took';
  if (type === 'repayment_received') return `${name} paid`;
  return 'You paid';
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  summary: { gap: spacing.sm },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between' },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
