import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Alert } from 'react-native';
import {
  AppButton,
  AppText,
  FormScreen,
  NativeDataNotice,
  Screen,
  ScreenState,
} from '@/components/ui';
import { colors } from '@/constants/theme';
import { PersonForm, type PersonFormValues } from '@/features/people/PersonForm';
import type { Person } from '@/features/people/person.types';
import {
  archivePerson,
  getPerson,
  isLocalFinanceDataAvailable,
  unarchivePerson,
  updatePerson,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [person, setPerson] = useState<Person>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    try {
      setPerson(getPerson(Number(id)));
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
    <FormScreen title="Edit Person">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <PersonForm
        initialValues={{ name: currentPerson.name, note: currentPerson.note ?? '' }}
        saving={saving}
        onSave={save}
      />
      <AppText color={colors.textMuted}>
        Lending and repayment history will appear here in a later milestone.
      </AppText>
      <AppButton
        label={currentPerson.isArchived ? 'Unarchive Person' : 'Archive Person'}
        variant="secondary"
        disabled={saving}
        onPress={toggleArchive}
      />
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
