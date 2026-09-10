import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { PersonForm, type PersonFormValues } from '@/features/people/PersonForm';
import { createPerson, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';

export default function NewPersonScreen() {
  const { space } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  return (
    <FormScreen title="New Person" backIcon="x">
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}
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
