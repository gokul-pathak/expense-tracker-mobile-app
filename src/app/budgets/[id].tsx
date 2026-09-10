import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ErrorState, FormScreen, NativeDataNotice, Screen, Skeleton } from '@/components/ui';
import { BudgetForm } from '@/features/budgets/BudgetForm';
import { formatPeriodMonth } from '@/features/budgets/budget.period';
import type { Budget } from '@/features/budgets/budget.types';
import type { Category } from '@/features/categories/category.types';
import {
  getAppSettings,
  getBudget,
  isLocalFinanceDataAvailable,
  listExpenseCategories,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

export default function EditBudgetScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [budget, setBudget] = useState<Budget>();
  const [categories, setCategories] = useState<Category[]>();
  const [currency, setCurrency] = useState('NPR');
  const [error, setError] = useState('');
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setError('This link is invalid.');
      return;
    }
    setError('');
    try {
      setBudget(getBudget(routeId));
      setCategories(listExpenseCategories());
      setCurrency(getAppSettings().defaultCurrency);
    } catch (caught) {
      console.error('Could not load budget.', caught);
      setError('This budget may have been deleted since you opened it.');
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
  if (error) {
    return (
      <FormScreen title="Budget" backIcon="x">
        <ErrorState
          title="Budget unavailable"
          message={error}
          onRetry={routeId === null ? undefined : load}
        />
      </FormScreen>
    );
  }
  if (!budget || !categories) {
    return (
      <FormScreen title="Budget" backIcon="x">
        <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.xl }} />
      </FormScreen>
    );
  }

  return (
    <BudgetForm
      budget={budget}
      categories={categories}
      defaultCurrency={currency}
      initialMonth={budget.periodMonth ?? formatPeriodMonth(new Date())}
    />
  );
}
