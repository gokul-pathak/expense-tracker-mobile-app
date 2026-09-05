import { useState } from 'react';
import { router } from 'expo-router';
import { AppText, FormScreen, NativeDataNotice, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { CategoryForm, type CategoryFormValues } from '@/features/categories/CategoryForm';
import { createCategory, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
export default function NewCategoryScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return (
    <FormScreen title="New Category">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
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
