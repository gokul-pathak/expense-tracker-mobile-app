import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  AmountInput,
  Banner,
  Button,
  CategoryChip,
  Dialog,
  FormScreen,
  PickerSheet,
  SelectorField,
  Text,
  type PickerOption,
} from '@/components/ui';
import { formatPeriodMonth, type PeriodMonth } from '@/features/budgets/budget.period';
import type { Budget } from '@/features/budgets/budget.types';
import type { Category } from '@/features/categories/category.types';
import { createBudget, deleteBudget, updateBudget } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';

/** The overall monthly limit has no category, and `null` is not a valid picker value. */
const OVERALL = 0;

type Props = {
  categories: Category[];
  defaultCurrency: string;
  /** Present when editing. */
  budget?: Budget;
  initialMonth: PeriodMonth;
};

/**
 * Amount, what it covers, and which month. Editing a budget changes the plan
 * and nothing else — no spending record is touched, and what was spent is
 * recomputed against the new plan rather than adjusted.
 */
export function BudgetForm({ categories, defaultCurrency, budget, initialMonth }: Props) {
  const { space } = useTheme();
  const [amount, setAmount] = useState(budget ? amountInput(budget.amountMinor) : '');
  // A new budget starts as the overall limit, which is the only choice that
  // means something before a category has been picked.
  const [categoryId, setCategoryId] = useState<number>(budget?.categoryId ?? OVERALL);
  const [month, setMonth] = useState<PeriodMonth>(budget?.periodMonth ?? initialMonth);
  const [showCategories, setShowCategories] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const currency = budget?.currency ?? defaultCurrency;
  const selectedCategory = categories.find((category) => category.id === categoryId);

  const categoryOptions: PickerOption<number>[] = [
    { value: OVERALL, label: 'Everything', detail: 'One limit for the whole month' },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
      leading: <CategoryChip categoryIcon={category.icon} size={28} />,
    })),
  ];
  const monthOptions: PickerOption<string>[] = nearbyMonths().map((value) => ({
    value,
    label: monthLabel(value),
  }));

  const save = useCallback(() => {
    if (submitting.current) return;
    const amountMinor = parseMoneyToMinorUnits(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const input = {
        categoryId: categoryId === OVERALL ? null : categoryId,
        periodMonth: month,
        amountMinor,
        currency,
      };
      if (budget) updateBudget(budget.id, input);
      else createBudget(input);
      router.back();
    } catch (caught) {
      setError(mapBudgetError(getUserErrorMessage(caught)));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [amount, categoryId, month, currency, budget]);

  return (
    <FormScreen
      title={budget ? 'Edit Budget' : 'Set a Budget'}
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: saving }}
      footer={<Button label="Save Budget" large loading={saving} onPress={save} />}
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <AmountInput
        value={amount}
        onChangeText={setAmount}
        currency={currency}
        label="Budget"
        autoFocus={!budget}
      />

      <View style={{ marginTop: space.xl, gap: space.md }}>
        <SelectorField
          label="Covers"
          value={categoryId === OVERALL ? 'Everything' : selectedCategory?.name}
          placeholder="Choose"
          leading={
            selectedCategory ? (
              <CategoryChip categoryIcon={selectedCategory.icon} size={28} />
            ) : null
          }
          onPress={() => setShowCategories(true)}
        />
        <SelectorField
          label="Month"
          value={monthLabel(month)}
          onPress={() => setShowMonths(true)}
        />
      </View>

      <Text variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
        {categoryId === OVERALL
          ? 'One limit covering every expense this month. It is not added to your category budgets — it already includes them.'
          : 'A limit for this category alone. Nothing carries over to next month.'}
      </Text>

      {budget ? (
        <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
          <Button
            label="Delete Budget"
            variant="destructive"
            disabled={saving}
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : null}

      <PickerSheet
        visible={showCategories}
        onClose={() => setShowCategories(false)}
        title="What does it cover?"
        options={categoryOptions}
        selected={categoryId}
        onSelect={setCategoryId}
      />
      <PickerSheet
        visible={showMonths}
        onClose={() => setShowMonths(false)}
        title="Which month?"
        options={monthOptions}
        selected={month}
        onSelect={setMonth}
      />

      <Dialog
        visible={confirming}
        title="Delete this budget?"
        message="The plan is removed. Nothing you have spent is changed or deleted."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </FormScreen>
  );

  function remove() {
    if (!budget) return;
    setConfirming(false);
    try {
      deleteBudget(budget.id);
      router.back();
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    }
  }
}

/** A year back and a year forward. A budget further out than that is a guess. */
function nearbyMonths(): PeriodMonth[] {
  const now = new Date();
  const months: PeriodMonth[] = [];
  for (let offset = -12; offset <= 12; offset += 1) {
    months.push(formatPeriodMonth(new Date(now.getFullYear(), now.getMonth() + offset, 1)));
  }
  return months.reverse();
}

function monthLabel(month: PeriodMonth) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, index, 1),
  );
}

function amountInput(minorUnits: number) {
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;
}

function mapBudgetError(message: string) {
  if (message.includes('already')) {
    return 'A budget already covers this category in this month. Edit that one instead.';
  }
  return message;
}
