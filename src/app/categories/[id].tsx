import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { AppText, FormScreen, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors } from '@/constants/theme';
import { CategoryForm, type CategoryFormValues } from '@/features/categories/CategoryForm';
import type { Category } from '@/features/categories/category.types';
import { getCategory, isLocalFinanceDataAvailable, updateCategory } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
export default function CategoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<Category>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    try {
      setCategory(getCategory(Number(id)));
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
  if (error && !category)
    return (
      <Screen>
        <ScreenState
          title="Could not load category"
          description={error}
          retry={() => router.back()}
        />
      </Screen>
    );
  if (!category)
    return (
      <Screen>
        <ScreenState title="Loading category" description="Reading your local category..." />
      </Screen>
    );
  const currentCategory = category;
  return (
    <FormScreen title="Edit Category">
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
      <CategoryForm
        initialValues={{
          name: currentCategory.name,
          type: currentCategory.type,
          icon: currentCategory.icon ?? '',
        }}
        saving={saving}
        onSave={save}
      />
    </FormScreen>
  );
  function save(values: CategoryFormValues) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      setCategory(updateCategory(currentCategory.id, { ...values, icon: values.icon || null }));
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
}
