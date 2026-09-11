import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  AmountInput,
  Banner,
  Button,
  CategoryChip,
  EmptyState,
  ErrorState,
  FormScreen,
  Icon,
  isIconName,
  PickerSheet,
  SegmentedControl,
  SelectorField,
  Skeleton,
  Switch,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import {
  PAYMENT_MODES,
  RECURRING_FREQUENCIES,
  type PaymentMode,
  type RecurringFrequency,
  type RecurringTransactionType,
} from '@/db/constants';
import type { Account } from '@/features/accounts/account.types';
import type { Category } from '@/features/categories/category.types';
import {
  createRecurringTemplate,
  getAccount,
  getAccountBalance,
  listActiveAccounts,
  listExpenseCategories,
  listIncomeCategories,
  listTemplateHistory,
  updateRecurringTemplate,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { accountTypeIcon, useTheme } from '@/theme';
import { formatMinorUnits, parseMoneyToMinorUnits } from '@/utils/money';

import { IntervalStepper } from './IntervalStepper';
import {
  describeRecurrence,
  formatScheduledLong,
  frequencyLabel,
  getScheduleExplanation,
} from './recurring-presentation';
import { isLocalDate, localDateOf, parseLocalDate, type LocalDate } from './recurring-schedule';
import type { RecurringTemplate } from './recurring.types';

const paymentModeLabels: Record<PaymentMode, string> = {
  cash: 'Cash',
  debit_card: 'Debit Card',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  qr: 'QR',
  digital_wallet: 'Digital Wallet',
  cheque: 'Cheque',
  other: 'Other',
};

const formSchema = z.object({
  amount: z.string().superRefine((value, context) => {
    const amountMinor = parseMoneyToMinorUnits(value);
    if (amountMinor === null) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid amount with up to 2 decimal places.',
      });
    } else if (amountMinor <= 0) {
      context.addIssue({ code: 'custom', message: 'Enter an amount greater than 0.' });
    }
  }),
  categoryId: z.number().int().positive('Choose a category.'),
  accountId: z.number().int().positive('Choose an account.'),
  title: z.string(),
  note: z.string(),
  paymentMode: z.enum(PAYMENT_MODES).nullable(),
});

type FormValues = z.infer<typeof formSchema>;
type Selector = 'category' | 'account' | 'frequency' | 'paymentMode' | null;

export function RecurringForm({ template }: { template?: RecurringTemplate }) {
  const { space, palette } = useTheme();
  const editing = template !== undefined;

  const [type, setType] = useState<RecurringTransactionType>(template?.type ?? 'expense');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [balances, setBalances] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [selector, setSelector] = useState<Selector>(null);
  const [moreDetails, setMoreDetails] = useState(editing);
  const [scheduleLocked, setScheduleLocked] = useState(false);

  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(
    template?.accountId,
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(
    template?.categoryId,
  );
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentMode | null>(
    template?.paymentMode ?? null,
  );
  const [frequency, setFrequency] = useState<RecurringFrequency>(template?.frequency ?? 'monthly');
  const [interval, setInterval] = useState<number>(template?.interval ?? 1);
  const [startDate, setStartDate] = useState<LocalDate>(
    template?.startDate ?? localDateOf(new Date()),
  );
  const [endDateEnabled, setEndDateEnabled] = useState<boolean>(template?.endDate != null);
  const [endDate, setEndDate] = useState<LocalDate | null>(template?.endDate ?? null);
  const [datePicker, setDatePicker] = useState<'start' | 'end' | null>(null);
  const [initialAccount, setInitialAccount] = useState<Account | undefined>();

  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: template ? amountInput(template.amountMinor) : '',
      categoryId: template?.categoryId,
      accountId: template?.accountId,
      title: template?.title ?? '',
      note: template?.note ?? '',
      paymentMode: template?.paymentMode ?? null,
    },
  });

  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ?? initialAccount;
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const currency = selectedAccount?.currency ?? 'NPR';
  const title = editing
    ? `Edit Recurring ${type === 'expense' ? 'Expense' : 'Income'}`
    : 'Add Recurring Transaction';
  const categoryLabelText = type === 'expense' ? 'Category' : 'Source';

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    try {
      const nextAccounts = listActiveAccounts();
      setAccounts(nextAccounts);
      setCategories(type === 'expense' ? listExpenseCategories() : listIncomeCategories());
      setBalances(
        new Map(nextAccounts.map((account) => [account.id, getAccountBalance(account.id)])),
      );
      if (template) {
        // The account may be archived now, so it is not in the active list; it is
        // still the template's account until changed, so it is fetched directly.
        const account = getAccount(template.accountId);
        setInitialAccount(account);
        setScheduleLocked(listTemplateHistory(template.id, 1).length > 0);
      } else if (selectedAccountId === undefined && nextAccounts.length === 1 && nextAccounts[0]) {
        setValue('accountId', nextAccounts[0].id);
        setSelectedAccountId(nextAccounts[0].id);
      }
    } catch (error) {
      console.error('Could not load recurring entry data.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [template, type, selectedAccountId, setValue]);
  useFocusEffect(load);

  if (loading) {
    return (
      <FormScreen title={title} backIcon="x">
        <EntrySkeleton />
      </FormScreen>
    );
  }
  if (failed) {
    return (
      <FormScreen title={title} backIcon="x">
        <ErrorState
          message="Your local accounts or categories could not be read. Your data is safe."
          onRetry={load}
        />
      </FormScreen>
    );
  }
  if (accounts.length === 0 && !editing) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="card"
          title="Add an account first"
          body="A recurring transaction records against the account the money leaves or arrives in."
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </FormScreen>
    );
  }
  if (categories.length === 0 && !editing) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="ledger"
          title={`No ${type} categories yet`}
          body={`Every recurring ${type} is filed under a category, so add one before setting this up.`}
          action={{ label: 'Go to Categories', onPress: () => router.push('/categories' as never) }}
        />
      </FormScreen>
    );
  }

  const categoryOptions: PickerOption<number>[] = categories.map((category) => ({
    value: category.id,
    label: category.name,
    leading: <CategoryChip categoryIcon={category.icon} size={28} />,
  }));
  const accountOptions: PickerOption<number>[] = accounts.map((account) => ({
    value: account.id,
    label: account.name,
    detail: formatMinorUnits(balances.get(account.id) ?? 0, account.currency),
    icon: accountIcon(account.type),
  }));
  const frequencyOptions: PickerOption<RecurringFrequency>[] = RECURRING_FREQUENCIES.map(
    (value) => ({
      value,
      label: frequencyLabel(value),
    }),
  );
  const paymentModeOptions: PickerOption<PaymentMode>[] = PAYMENT_MODES.map((mode) => ({
    value: mode,
    label: paymentModeLabels[mode],
  }));

  const explanation = getScheduleExplanation({ frequency, startDate });

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: handleSubmit(save), disabled: saving }}
      footer={
        <Button
          label={editing ? 'Save Changes' : 'Save Recurring'}
          large
          loading={saving}
          onPress={handleSubmit(save)}
        />
      }
    >
      {formError ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      {!editing ? (
        <View style={{ marginBottom: space.lg }}>
          <SegmentedControl
            accessibilityLabel="Recurring transaction type"
            segments={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
            value={type}
            onChange={(next) => {
              if (next === type) return;
              setType(next);
              setSelectedCategoryId(undefined);
              setValue('categoryId', undefined as never, { shouldValidate: false });
            }}
          />
        </View>
      ) : null}

      <Controller
        control={control}
        name="amount"
        render={({ field: { onChange, value } }) => (
          <AmountInput
            value={value}
            onChangeText={onChange}
            currency={currency}
            direction={type}
            autoFocus={!editing}
            error={errors.amount?.message}
          />
        )}
      />
      {editing ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
          Changes apply to transactions generated from now on. Existing ones are not changed.
        </Text>
      ) : null}

      <View style={[styles.fields, { marginTop: space.xl, gap: space.md }]}>
        <SelectorField
          label={categoryLabelText}
          value={selectedCategory?.name}
          placeholder={`Choose ${categoryLabelText.toLowerCase()}`}
          leading={
            selectedCategory ? (
              <CategoryChip categoryIcon={selectedCategory.icon} size={28} />
            ) : null
          }
          error={errors.categoryId?.message}
          onPress={() => setSelector('category')}
        />
        <SelectorField
          label="Account"
          value={selectedAccount?.name}
          placeholder="Choose account"
          icon={selectedAccount ? accountIcon(selectedAccount.type) : undefined}
          detail={
            selectedAccount
              ? formatMinorUnits(balances.get(selectedAccount.id) ?? 0, selectedAccount.currency)
              : undefined
          }
          error={errors.accountId?.message}
          onPress={() => setSelector('account')}
        />

        {scheduleLocked ? (
          <Banner
            tone="info"
            message="The schedule can’t be changed after occurrences have been generated or skipped."
          />
        ) : null}

        <SelectorField
          label="Frequency"
          value={frequencyLabel(frequency)}
          disabled={scheduleLocked}
          onPress={() => setSelector('frequency')}
        />
        {scheduleLocked ? null : (
          <IntervalStepper value={interval} onChange={setInterval} frequency={frequency} />
        )}
        <SelectorField
          label="Start date"
          value={formatScheduledLong(startDate)}
          disabled={scheduleLocked}
          onPress={() => setDatePicker('start')}
        />

        <View
          style={[styles.summary, { borderColor: palette.hairline, paddingVertical: space.sm }]}
        >
          <Text variant="smallStrong" tone="secondary">
            {describeRecurrence(frequency, interval)}
          </Text>
          {explanation ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
              {explanation}
            </Text>
          ) : null}
        </View>

        <MoreDetails expanded={moreDetails} onToggle={() => setMoreDetails((open) => !open)} />

        {moreDetails ? (
          <View style={{ gap: space.md }}>
            <View style={[styles.endToggle, { paddingVertical: space.xs }]}>
              <View style={styles.endLabel}>
                <Text variant="body">Set an end date</Text>
                <Text variant="caption" tone="tertiary">
                  Repeats until paused or deleted otherwise.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Set an end date"
                value={endDateEnabled}
                onValueChange={(next) => {
                  setEndDateEnabled(next);
                  if (!next) setEndDate(null);
                  else if (endDate === null) setEndDate(startDate);
                }}
              />
            </View>
            {endDateEnabled ? (
              <SelectorField
                label="Ends on"
                value={endDate ? formatScheduledLong(endDate) : undefined}
                placeholder="Choose a date"
                onPress={() => setDatePicker('end')}
              />
            ) : null}

            <Controller
              control={control}
              name="title"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextField
                  label="Title"
                  placeholder={selectedCategory?.name ?? 'Optional'}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
            <SelectorField
              label="Payment Mode"
              value={selectedPaymentMode ? paymentModeLabels[selectedPaymentMode] : undefined}
              placeholder="Optional"
              onPress={() => setSelector('paymentMode')}
            />
            <Controller
              control={control}
              name="note"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextField
                  label="Note"
                  placeholder="Copied to each generated transaction"
                  multiline
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
          </View>
        ) : null}
      </View>

      {datePicker !== null ? (
        <DateTimePicker
          mode="date"
          minimumDate={datePicker === 'end' ? civilNoon(startDate) : undefined}
          value={pickerValue(datePicker === 'end' ? endDate : startDate, startDate)}
          onChange={(_event, date) => {
            const which = datePicker;
            setDatePicker(null);
            if (!date || which === null) return;
            const local = localDateOf(date);
            if (which === 'start') {
              setStartDate(local);
              if (endDate !== null && endDate < local) setEndDate(local);
            } else {
              setEndDate(local);
            }
          }}
        />
      ) : null}

      <PickerSheet
        visible={selector === 'category'}
        onClose={() => setSelector(null)}
        title={`Choose ${categoryLabelText.toLowerCase()}`}
        options={categoryOptions}
        selected={selectedCategoryId}
        emptyMessage={`No ${type} categories yet. Add one from Categories first.`}
        onSelect={(id) => {
          setValue('categoryId', id, { shouldValidate: true });
          setSelectedCategoryId(id);
        }}
      />
      <PickerSheet
        visible={selector === 'account'}
        onClose={() => setSelector(null)}
        title="Choose account"
        options={accountOptions}
        selected={selectedAccountId}
        onSelect={(id) => {
          setValue('accountId', id, { shouldValidate: true });
          setSelectedAccountId(id);
        }}
        footer={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
      />
      <PickerSheet
        visible={selector === 'frequency'}
        onClose={() => setSelector(null)}
        title="Frequency"
        options={frequencyOptions}
        selected={frequency}
        onSelect={(next) => setFrequency(next)}
      />
      <PickerSheet
        visible={selector === 'paymentMode'}
        onClose={() => setSelector(null)}
        title="Payment mode"
        options={paymentModeOptions}
        selected={selectedPaymentMode ?? undefined}
        clearOption={{
          label: 'None',
          onSelect: () => {
            setValue('paymentMode', null);
            setSelectedPaymentMode(null);
          },
        }}
        onSelect={(mode) => {
          setValue('paymentMode', mode);
          setSelectedPaymentMode(mode);
        }}
      />
    </FormScreen>
  );

  function save(values: FormValues) {
    if (submitting.current) return;
    const amountMinor = parseMoneyToMinorUnits(values.amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('amount', { message: 'Enter an amount greater than 0.' });
      return;
    }
    if (endDateEnabled && (endDate === null || !isLocalDate(endDate) || endDate < startDate)) {
      setFormError('The end date cannot be before the start date.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const titleValue = values.title.trim();
      if (!editing) {
        createRecurringTemplate({
          type,
          amountMinor,
          categoryId: values.categoryId,
          accountId: values.accountId,
          startDate,
          frequency,
          interval,
          endDate: endDateEnabled ? endDate : null,
          title: titleValue || null,
          note: values.note.trim() || null,
          paymentMode: values.paymentMode,
        });
      } else {
        updateRecurringTemplate(template.id, {
          amountMinor,
          categoryId: values.categoryId,
          accountId: values.accountId,
          startDate,
          frequency,
          interval,
          endDate: endDateEnabled ? endDate : null,
          title: titleValue,
          note: values.note.trim() || null,
          paymentMode: values.paymentMode,
        });
      }
      router.back();
    } catch (error) {
      console.error('Could not save recurring transaction.', error);
      setFormError(getUserErrorMessage(error));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}

/**
 * End date, payment mode, title and note are collapsed by default. Most
 * recurring transactions have no end and take the category as their name, so a
 * form that opens with all of them reads as more work than it is.
 */
function MoreDetails({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { palette, space, size } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More details"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.moreDetails,
        { minHeight: size.touchTarget, paddingHorizontal: space.lg },
        pressed && styles.pressed,
      ]}
    >
      <Text variant="smallStrong" tone="secondary">
        More Details
      </Text>
      <Icon
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={palette.textTertiary}
      />
    </Pressable>
  );
}

function EntrySkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Skeleton width={72} height={12} radius="pill" style={styles.centred} />
      <Skeleton width={220} height={44} radius="pill" style={[styles.centred, { marginTop: 14 }]} />
      <View style={{ marginTop: space.xxl + space.lg, gap: space.md }}>
        <Skeleton height={size.control} radius={radius.control} />
        <Skeleton height={size.control} radius={radius.control} />
        <Skeleton height={size.control} radius={radius.control} />
      </View>
    </View>
  );
}

function accountIcon(accountType: string) {
  const key = accountTypeIcon[accountType];
  return isIconName(key) ? key : 'wallet';
}

function amountInput(minorUnits: number) {
  const whole = Math.floor(minorUnits / 100);
  const fraction = String(minorUnits % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** A local `Date` at noon for the picker's initial value; never stored or compared. */
function civilNoon(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  return new Date(year, month - 1, day, 12);
}

function pickerValue(date: LocalDate | null, fallback: LocalDate): Date {
  return civilNoon(date ?? fallback);
}

const styles = StyleSheet.create({
  fields: { width: '100%' },
  moreDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.7 },
  summary: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  endToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  endLabel: { flex: 1, minWidth: 0, gap: 2, paddingRight: 12 },
  centred: { alignSelf: 'center' },
});
