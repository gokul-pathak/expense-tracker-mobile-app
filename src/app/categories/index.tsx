import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton, AppText, Card, NativeDataNotice, Screen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import {
  isLocalFinanceDataAvailable,
  listExpenseCategories,
  listIncomeCategories,
} from '@/features/ui/data';
import type { Category } from '@/features/categories/category.types';
export default function CategoriesScreen() {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setLoading(true);
    setFailed(false);
    try {
      setItems(type === 'expense' ? listExpenseCategories() : listIncomeCategories());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [type]);
  useFocusEffect(load);
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  if (loading)
    return (
      <Screen>
        <ScreenState title="Loading categories" description="Reading your local categories..." />
      </Screen>
    );
  if (failed)
    return (
      <Screen>
        <ScreenState
          title="Could not load categories"
          description="Your local data could not be read."
          retry={load}
        />
      </Screen>
    );
  return (
    <Screen scroll contentStyle={styles.content}>
      <AppText variant="title" weight="700">
        Categories
      </AppText>
      <View style={styles.segment}>
        <Tab label="Expense" selected={type === 'expense'} onPress={() => setType('expense')} />
        <Tab label="Income" selected={type === 'income'} onPress={() => setType('income')} />
      </View>
      {items.length === 0 ? (
        <ScreenState
          title="No categories yet."
          description="Add a category to organize future transactions."
        />
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.name}`}
            onPress={() => router.push(`/categories/${item.id}` as never)}
          >
            <Card style={styles.row}>
              <View>
                <AppText weight="700">{item.name}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {item.isDefault ? 'Default category' : 'Custom category'}
                </AppText>
              </View>
              <AppText color={colors.textMuted}>›</AppText>
            </Card>
          </Pressable>
        ))
      )}
      <AppButton label="+ Add Category" onPress={() => router.push('/categories/new' as never)} />
    </Screen>
  );
}
function Tab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.selected]}
    >
      <AppText weight="600" color={selected ? colors.surface : colors.textMuted}>
        {label}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  segment: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  selected: { backgroundColor: colors.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
