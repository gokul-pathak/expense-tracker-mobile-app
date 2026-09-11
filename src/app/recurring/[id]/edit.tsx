import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { EmptyState, FormScreen, NativeDataNotice, Screen, Skeleton } from '@/components/ui';
import { RecurringForm } from '@/features/recurring/RecurringForm';
import type { RecurringTemplate } from '@/features/recurring/recurring.types';
import { NotFoundError } from '@/features/shared/errors';
import { getRecurringTemplate, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'ready'; template: RecurringTemplate };

export default function EditRecurringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parseRouteId(id);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setState({ kind: 'missing' });
      return;
    }
    try {
      setState({ kind: 'ready', template: getRecurringTemplate(routeId) });
    } catch (error) {
      setState(error instanceof NotFoundError ? { kind: 'missing' } : { kind: 'failed' });
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
  if (state.kind === 'loading') {
    return (
      <FormScreen title="Edit Recurring Transaction" backIcon="x">
        <EditSkeleton />
      </FormScreen>
    );
  }
  if (state.kind === 'missing') {
    return (
      <FormScreen title="Edit Recurring Transaction" backIcon="x">
        <EmptyState
          illustration="ledger"
          title="This recurring transaction no longer exists"
          body="It may have been deleted on this or another device."
          action={{ label: 'View Recurring', onPress: () => router.replace('/recurring' as never) }}
        />
      </FormScreen>
    );
  }
  if (state.kind === 'failed') {
    return (
      <FormScreen title="Edit Recurring Transaction" backIcon="x">
        <EmptyState
          illustration="ledger"
          title="Couldn’t open this recurring transaction"
          body="Your data is safe. Try again from the recurring list."
          action={{ label: 'View Recurring', onPress: () => router.replace('/recurring' as never) }}
        />
      </FormScreen>
    );
  }

  return <RecurringForm template={state.template} />;
}

function EditSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ marginTop: space.lg, gap: space.md }}>
      <Skeleton width={220} height={44} radius="pill" style={{ alignSelf: 'center' }} />
      <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.lg }} />
      <Skeleton height={size.control} radius={radius.control} />
      <Skeleton height={size.control} radius={radius.control} />
    </View>
  );
}
