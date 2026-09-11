import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  FormScreen,
  NativeDataNotice,
  Screen,
  Skeleton,
} from '@/components/ui';
import { BudgetForm } from '@/features/budgets/BudgetForm';
import { currentPeriodMonth } from '@/features/budgets/budget-presentation';
import type { Budget } from '@/features/budgets/budget.types';
import type { Category } from '@/features/categories/category.types';
import { NotFoundError } from '@/features/shared/errors';
import {
  getAppSettings,
  getBudget,
  isLocalFinanceDataAvailable,
  listExpenseCategories,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

type State =
  | { kind: 'loading' }
  /** The id is not a budget id, or names a budget that has been deleted. */
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'ready'; budget: Budget; categories: Category[]; currency: string };

export default function EditBudgetScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const routeId = parseRouteId(id);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    // A link with a nonsense id, and a link to a budget deleted here or on
    // another device, are the same thing to the person looking at the screen:
    // there is nothing to open. Neither is an error, and neither may crash.
    if (routeId === null) {
      setState({ kind: 'missing' });
      return;
    }
    try {
      setState({
        kind: 'ready',
        budget: getBudget(routeId),
        categories: listExpenseCategories(),
        currency: getAppSettings().defaultCurrency,
      });
    } catch (caught) {
      if (caught instanceof NotFoundError) {
        setState({ kind: 'missing' });
        return;
      }
      console.error('Could not load budget.', caught);
      setState({ kind: 'failed' });
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

  if (state.kind === 'missing') {
    return (
      <FormScreen title="Budget" backIcon="x">
        <EmptyState
          illustration="arcs"
          title="This budget no longer exists"
          body="It may have been deleted on this device or on another one. Your transactions are unaffected."
          action={{ label: 'View Budgets', onPress: () => router.replace('/budgets' as never) }}
        />
      </FormScreen>
    );
  }

  if (state.kind === 'failed') {
    return (
      <FormScreen title="Budget" backIcon="x">
        <ErrorState
          title="Budget unavailable"
          message="We couldn't load this budget. Your data is safe."
          onRetry={load}
        />
        <Button
          label="View Budgets"
          variant="text"
          onPress={() => router.replace('/budgets' as never)}
        />
      </FormScreen>
    );
  }

  if (state.kind === 'loading') {
    return (
      <FormScreen title="Budget" backIcon="x">
        <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.xl }} />
      </FormScreen>
    );
  }

  return (
    <BudgetForm
      budget={state.budget}
      categories={state.categories}
      defaultCurrency={state.currency}
      initialMonth={state.budget.periodMonth ?? currentPeriodMonth()}
    />
  );
}
