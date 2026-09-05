import { useState } from 'react';
import { router } from 'expo-router';
import { AppText, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { PersonForm, type PersonFormValues } from '@/features/people/PersonForm';
import { createPerson, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
export default function NewPersonScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return (
    <FormScreen title="New Person">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <PersonForm saving={saving} onSave={save} />
    </FormScreen>
  );
  function save(values: PersonFormValues) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      createPerson({ ...values, note: values.note || undefined });
      router.back();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
}
