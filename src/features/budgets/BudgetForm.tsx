import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import type { Category } from '@/features/categories/category.types';
import { createBudget, deleteBudget, listBudgetsForMonth, updateBudget } from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { useTheme } from '@/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';

import {
  describeBudgetConflict,
  getMonthLabel,
  getShortMonthLabel,
  stepPeriodMonth,
} from './budget-presentation';
import { formatPeriodMonth, type PeriodMonth } from './budget.period';
import type { Budget } from './budget.types';

/** The overall monthly limit has no category, and `null` is not a valid picker value. */
const OVERALL = 0;

export type BudgetFormType = 'overall' | 'category';

type Props = {
  categories: Category[];
  defaultCurrency: string;
  /** Present when editing. */
  budget?: Budget;
  initialMonth: PeriodMonth;
  /** Which kind of budget the entry point was for. Ignored when editing. */
  initialType?: BudgetFormType;
};

/**
 * Amount, what it covers, and which month.
 *
 * Editing a budget changes the plan and nothing else — no spending record is
 * touched, and what was spent is recomputed against the new plan rather than
 * adjusted. Deleting one removes a plan and no transaction.
 *
 * One budget exists per month, currency and category, so the form knows which
 * of those are already taken before anything is submitted: choosing one offers
 * the way to the budget that already exists rather than letting a save fail.
 * The service still refuses a duplicate, because a second device can create one
 * between this screen loading and the user pressing Save.
 */
export function BudgetForm({
  categories,
  defaultCurrency,
  budget,
  initialMonth,
  initialType,
}: Props) {
  const { space } = useTheme();
  const [amount, setAmount] = useState(budget ? amountInput(budget.amountMinor) : '');
  // `undefined` is "not chosen yet". A category entry point deliberately picks
  // nothing: auto-selecting one would file a budget under a category the user
  // never looked at.
  const [categoryId, setCategoryId] = useState<number | undefined>(
    budget ? (budget.categoryId ?? OVERALL) : initialType === 'category' ? undefined : OVERALL,
  );
  const [month, setMonth] = useState<PeriodMonth>(budget?.periodMonth ?? initialMonth);
  const [showCategories, setShowCategories] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const removing = useRef(false);

  const currency = budget?.currency ?? defaultCurrency;
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const isOverall = categoryId === OVERALL;
  const chosen = categoryId !== undefined;

  /**
   * Which budgets the chosen month already holds, in this currency.
   *
   * Read where it is needed rather than copied into state: a different month has
   * different answers, and a piece of state would have to be kept in step with
   * the month by hand. The read is a synchronous SQLite query, as every read in
   * this app is.
   */
  const taken = useMemo(() => {
    try {
      return listBudgetsForMonth(month).filter(
        (existing: Budget) => existing.currency === currency && existing.id !== budget?.id,
      );
    } catch (caught) {
      // Not being able to check is not a reason to block the form: the service
      // refuses a duplicate regardless, and its message says the same thing.
      console.error('Could not read existing budgets for this month.', caught);
      return [];
    }
  }, [month, currency, budget?.id]);

  const conflict = useMemo(() => {
    if (!chosen) return null;
    return (
      taken.find((existing) =>
        isOverall ? existing.categoryId === null : existing.categoryId === categoryId,
      ) ?? null
    );
  }, [taken, chosen, isOverall, categoryId]);

  const categoryOptions: PickerOption<number>[] = [
    {
      value: OVERALL,
      label: 'Everything',
      detail: taken.some((existing) => existing.categoryId === null)
        ? 'Already budgeted this month'
        : 'One limit for the whole month',
    },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
      detail: taken.some((existing) => existing.categoryId === category.id)
        ? 'Already budgeted this month'
        : undefined,
      leading: <CategoryChip categoryIcon={category.icon} size={28} />,
    })),
  ];
  const monthOptions: PickerOption<string>[] = nearbyMonths().map((value) => ({
    value,
    label: getMonthLabel(value),
  }));

  const save = useCallback(() => {
    if (submitting.current) return;
    const amountMinor = parseMoneyToMinorUnits(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (!chosen) {
      setError('Choose what this budget covers.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const input = {
        categoryId: isOverall ? null : categoryId,
        periodMonth: month,
        amountMinor,
        currency,
      };
      if (budget) updateBudget(budget.id, input);
      else createBudget(input);
      router.back();
    } catch (caught) {
      setError(
        describeBudgetConflict(getUserErrorMessage(caught), {
          month,
          overall: isOverall,
          categoryName: selectedCategory?.name,
        }),
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [amount, categoryId, chosen, isOverall, month, currency, budget, selectedCategory?.name]);

  const busy = saving || deleting;
  const blocked = conflict !== null || !chosen;

  return (
    <FormScreen
      title={budget ? 'Edit Budget' : 'Set a Budget'}
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: busy || blocked }}
      footer={
        <Button
          label="Save Budget"
          large
          loading={saving}
          disabled={busy || blocked}
          onPress={save}
        />
      }
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      {conflict !== null ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner
            tone="warning"
            message={conflictMessage(month, isOverall, selectedCategory?.name)}
            action={{
              label: isOverall ? 'Edit Overall Budget' : 'Edit That Budget',
              onPress: () => router.replace(('/budgets/' + conflict.id) as never),
            }}
          />
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
          value={!chosen ? undefined : isOverall ? 'Everything' : selectedCategory?.name}
          placeholder="Choose a category"
          leading={
            selectedCategory ? (
              <CategoryChip categoryIcon={selectedCategory.icon} size={28} />
            ) : null
          }
          onPress={() => setShowCategories(true)}
        />
        <SelectorField
          label="Month"
          value={getMonthLabel(month)}
          onPress={() => setShowMonths(true)}
        />
      </View>

      <Text variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
        {!chosen
          ? 'Choose whether this covers every expense this month or one category.'
          : isOverall
            ? 'One limit covering every expense this month. It is not added to your category budgets — it already includes them.'
            : 'A limit for this category alone. Nothing carries over to next month.'}
      </Text>

      {budget ? (
        <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
          <Button
            label="Delete Budget"
            variant="destructive"
            disabled={busy}
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
        message="The plan is removed. Your transactions will not be deleted, and nothing you have spent is changed."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </FormScreen>
  );

  /** Guarded, so a second tap on the confirm button cannot delete twice. */
  function remove() {
    if (!budget || removing.current) return;
    removing.current = true;
    setDeleting(true);
    try {
      deleteBudget(budget.id);
      setConfirming(false);
      router.back();
    } catch (caught) {
      setConfirming(false);
      setError(getUserErrorMessage(caught));
    } finally {
      removing.current = false;
      setDeleting(false);
    }
  }
}

/** Names the budget that already exists, and the month it is in. */
function conflictMessage(month: PeriodMonth, overall: boolean, categoryName?: string) {
  const monthName = getShortMonthLabel(month);
  if (overall) return 'An overall budget already exists for ' + monthName + '.';
  return (
    'A ' + (categoryName ? categoryName + ' ' : '') + 'budget already exists for ' + monthName + '.'
  );
}

/** A year back and a year forward. A budget further out than that is a guess. */
function nearbyMonths(): PeriodMonth[] {
  const now = formatPeriodMonth(new Date());
  const months: PeriodMonth[] = [];
  for (let offset = 12; offset >= -12; offset -= 1) months.push(stepPeriodMonth(now, offset));
  return months;
}

function amountInput(minorUnits: number) {
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;
}
