import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ErrorState, FormScreen, NativeDataNotice, Screen, Skeleton } from '@/components/ui';
import { BudgetForm, type BudgetFormType } from '@/features/budgets/BudgetForm';
import { currentPeriodMonth } from '@/features/budgets/budget-presentation';
import { isPeriodMonth } from '@/features/budgets/budget.period';
import type { Category } from '@/features/categories/category.types';
import {
  getAppSettings,
  isLocalFinanceDataAvailable,
  listExpenseCategories,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

export default function NewBudgetScreen() {
  const { space, radius, size } = useTheme();
  const { month, type } = useLocalSearchParams<{ month?: string; type?: string }>();
  const [categories, setCategories] = useState<Category[]>();
  const [currency, setCurrency] = useState('NPR');
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      // Only expenses can be budgeted: a budget is a ceiling on spending, and
      // an income category has no ceiling to set. A category deleted here or on
      // another device is not offered either, by the same rule that keeps it out
      // of every other picker — a budget already filed under one still shows it.
      setCategories(listExpenseCategories());
      setCurrency(getAppSettings().defaultCurrency);
    } catch (error) {
      console.error('Could not load budget options.', error);
      setFailed(true);
    }
  }, []);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (failed) {
    return (
      <FormScreen title="Set a Budget" backIcon="x">
        <ErrorState
          message="Your categories could not be read. Your data is safe."
          onRetry={load}
        />
      </FormScreen>
    );
  }
  if (!categories) {
    return (
      <FormScreen title="Set a Budget" backIcon="x">
        <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.xl }} />
      </FormScreen>
    );
  }

  return (
    <BudgetForm
      categories={categories}
      defaultCurrency={currency}
      initialMonth={isPeriodMonth(month) ? month : currentPeriodMonth()}
      initialType={budgetType(type)}
    />
  );
}

/** The entry point's intent, when it had one. Anything else means "not decided". */
function budgetType(value: string | undefined): BudgetFormType | undefined {
  if (value === 'overall' || value === 'category') return value;
  return undefined;
}
