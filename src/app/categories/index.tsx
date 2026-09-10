import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  Button,
  Card,
  CategoryChip,
  EmptyState,
  ErrorState,
  FormScreen,
  ListRow,
  NativeDataNotice,
  Screen,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import type { Category } from '@/features/categories/category.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  isLocalFinanceDataAvailable,
  listExpenseCategories,
  listIncomeCategories,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

type CategoryScope = 'expense' | 'income';

const scopes = [
  { value: 'expense' as const, label: 'Expense' },
  { value: 'income' as const, label: 'Income' },
];

export default function CategoriesScreen() {
  const { space, radius, size } = useTheme();
  const [scope, setScope] = useState<CategoryScope>('expense');
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setItems(scope === 'expense' ? listExpenseCategories() : listIncomeCategories());
    } catch (error) {
      console.error('Could not load categories.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useFocusEffect(load);
  // A sync that changes SQLite refreshes this screen even while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  return (
    <FormScreen
      title="Categories"
      footer={
        items.length > 0 && !loading && !failed ? (
          <Button
            label="Add Category"
            variant="text"
            icon="plus"
            fullWidth
            onPress={() => router.push('/categories/new' as never)}
          />
        ) : undefined
      }
    >
      <View style={{ marginTop: space.sm }}>
        <SegmentedControl
          segments={scopes}
          value={scope}
          onChange={setScope}
          accessibilityLabel="Show expense or income categories"
        />
      </View>

      {loading ? (
        <Skeleton height={size.listRow * 6} radius={radius.card} style={{ marginTop: space.lg }} />
      ) : failed ? (
        <ErrorState
          message="Your local categories could not be read. Your data is safe."
          onRetry={load}
        />
      ) : items.length === 0 ? (
        <EmptyState
          illustration="ledger"
          title={`No ${scope} categories`}
          body="Categories are how spending gets grouped in reports. Add one to start filing transactions under it."
          action={{ label: 'Add Category', onPress: () => router.push('/categories/new' as never) }}
        />
      ) : (
        <Card padding="none" style={{ marginTop: space.lg }}>
          {items.map((item, index) => (
            <ListRow
              key={item.id}
              label={item.name}
              detail={item.isDefault ? 'Built in' : 'Custom'}
              leading={<CategoryChip categoryIcon={item.icon} size={32} />}
              onPress={() => router.push(`/categories/${item.id}` as never)}
              last={index === items.length - 1}
            />
          ))}
        </Card>
      )}
    </FormScreen>
  );
}
