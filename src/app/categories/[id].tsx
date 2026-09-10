import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  CategoryChip,
  ErrorState,
  FormScreen,
  NativeDataNotice,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import type { Category } from '@/features/categories/category.types';
import { CategoryForm, type CategoryFormValues } from '@/features/categories/CategoryForm';
import { getCategory, isLocalFinanceDataAvailable, updateCategory } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

export default function CategoryDetailScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<Category>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setError('This link is invalid.');
      return;
    }
    try {
      setCategory(getCategory(routeId));
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
  if (error && !category) {
    return (
      <FormScreen title="Category">
        <ErrorState
          title="Could not load category"
          message={error}
          onRetry={routeId === null ? undefined : load}
        />
      </FormScreen>
    );
  }
  if (!category) {
    return (
      <FormScreen title="Category">
        <View style={{ marginTop: space.xl, gap: space.lg }}>
          <Skeleton height={size.control} radius={radius.control} />
          <Skeleton height={size.control} radius={radius.control} />
        </View>
      </FormScreen>
    );
  }

  const currentCategory = category;

  return (
    <FormScreen title={currentCategory.name}>
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.md, gap: space.sm }}>
        <CategoryChip categoryIcon={currentCategory.icon} size={56} />
        <Text variant="caption" tone="tertiary">
          {currentCategory.isDefault ? 'Built in' : 'Custom'} ·{' '}
          {currentCategory.type === 'expense' ? 'Expense' : 'Income'}
        </Text>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <CategoryForm
          initialValues={{
            name: currentCategory.name,
            type: currentCategory.type,
            icon: currentCategory.icon ?? '',
          }}
          saving={saving}
          onSave={save}
        />
      </View>
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
