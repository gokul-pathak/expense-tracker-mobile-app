import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { CategoryForm, type CategoryFormValues } from '@/features/categories/CategoryForm';
import { createCategory, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';

export default function NewCategoryScreen() {
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
    <FormScreen title="New Category" backIcon="x">
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}
      <CategoryForm saving={saving} onSave={save} />
    </FormScreen>
  );

  function save(values: CategoryFormValues) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      createCategory({ ...values, icon: values.icon || undefined });
      router.back();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
}
