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
  SelectorField,
  Skeleton,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import { PAYMENT_MODES, type PaymentMode } from '@/db/constants';
import type { Account } from '@/features/accounts/account.types';
import type { Category } from '@/features/categories/category.types';
import type { Transaction, UpdateExpenseInput } from '@/features/transactions/transaction.types';
import {
  createExpense,
  createIncome,
  getAccount,
  listActiveAccounts,
  listExpenseCategories,
  listIncomeCategories,
  updateExpense,
  updateIncome,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { accountTypeIcon, useTheme } from '@/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';

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
  transactionDate: z.string().refine(isValidDate, 'Enter a valid date as YYYY-MM-DD.'),
  note: z.string(),
  paymentMode: z.enum(PAYMENT_MODES).nullable(),
});

type FormValues = z.infer<typeof formSchema>;
type EntryType = 'expense' | 'income';
type Selector = 'category' | 'account' | 'paymentMode' | null;

export function TransactionEntryForm({
  type,
  transaction,
}: {
  type: EntryType;
  transaction?: Transaction;
}) {
  const { space } = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [selector, setSelector] = useState<Selector>(null);
  const [moreDetails, setMoreDetails] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number>();
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentMode | null>(null);
  const [initialAccount, setInitialAccount] = useState<Account>();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: '',
      transactionDate: formatDate(new Date()),
      note: '',
      paymentMode: null,
    },
  });

  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ?? initialAccount;
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const title = transaction
    ? `Edit ${type === 'expense' ? 'Expense' : 'Income'}`
    : type === 'expense'
      ? 'Add Expense'
      : 'Add Income';
  const categoryLabel = type === 'expense' ? 'Category' : 'Source';
  const saveLabel = `Save ${type === 'expense' ? 'Expense' : 'Income'}`;

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    try {
      const nextAccounts = listActiveAccounts();
      setAccounts(nextAccounts);
      setCategories(type === 'expense' ? listExpenseCategories() : listIncomeCategories());
      if (transaction) {
        const accountId =
          transaction.type === 'expense'
            ? transaction.sourceAccountId
            : transaction.destinationAccountId;
        const account = accountId === null ? undefined : getAccount(accountId);
        setInitialAccount(account);
        setSelectedAccountId(accountId ?? undefined);
        setSelectedCategoryId(transaction.categoryId ?? undefined);
        setSelectedPaymentMode(transaction.paymentMode ?? null);
        setSelectedDate(transaction.transactionDate);
        reset({
          amount: formatAmountInput(transaction.amountMinor),
          accountId: accountId ?? undefined,
          categoryId: transaction.categoryId ?? undefined,
          transactionDate: formatDate(transaction.transactionDate),
          note: transaction.note ?? '',
          paymentMode: transaction.paymentMode ?? null,
        });
      } else if (nextAccounts.length === 1 && nextAccounts[0]) {
        setValue('accountId', nextAccounts[0].id);
        setSelectedAccountId(nextAccounts[0].id);
      }
    } catch (error) {
      console.error('Could not load transaction entry data.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [reset, setValue, transaction, type]);
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
  if (accounts.length === 0) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="card"
          title="Add an account first"
          body={`An ${type === 'expense' ? 'expense' : 'income'} is recorded against the account the money left or arrived in.`}
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </FormScreen>
    );
  }
  if (categories.length === 0) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="ledger"
          title={`No ${type} categories yet`}
          body={`Every ${type} is filed under a category, so add one before recording this.`}
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
    detail: accountTypeLabel(account.type),
    icon: accountIcon(account.type),
  }));
  const paymentModeOptions: PickerOption<PaymentMode>[] = PAYMENT_MODES.map((mode) => ({
    value: mode,
    label: paymentModeLabels[mode],
  }));

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: handleSubmit(save), disabled: saving }}
      footer={<Button label={saveLabel} large loading={saving} onPress={handleSubmit(save)} />}
    >
      {formError ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      <Controller
        control={control}
        name="amount"
        render={({ field: { onChange, value } }) => (
          <AmountInput
            value={value}
            onChangeText={onChange}
            currency={selectedAccount?.currency ?? 'NPR'}
            direction={type === 'expense' ? 'expense' : 'income'}
            error={errors.amount?.message}
          />
        )}
      />

      <View style={[styles.fields, { marginTop: space.xl, gap: space.md }]}>
        <SelectorField
          label={categoryLabel}
          value={selectedCategory?.name}
          placeholder={`Choose ${categoryLabel.toLowerCase()}`}
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
          error={errors.accountId?.message}
          onPress={() => setSelector('account')}
        />

        <MoreDetails expanded={moreDetails} onToggle={() => setMoreDetails((open) => !open)} />

        {moreDetails ? (
          <View style={{ gap: space.md }}>
            <SelectorField
              label="Date"
              value={describeDate(selectedDate)}
              error={errors.transactionDate?.message}
              onPress={() => setShowDatePicker(true)}
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
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <TextField
                  label="Note"
                  placeholder="What was this for?"
                  multiline
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        ) : null}
      </View>

      {showDatePicker ? (
        <DateTimePicker
          maximumDate={new Date()}
          mode="date"
          value={selectedDate}
          onChange={(_event, date) => {
            setShowDatePicker(false);
            if (!date) return;
            setSelectedDate(date);
            setValue('transactionDate', formatDate(date), { shouldValidate: true });
          }}
        />
      ) : null}

      <PickerSheet
        visible={selector === 'category'}
        onClose={() => setSelector(null)}
        title={`Choose ${categoryLabel.toLowerCase()}`}
        options={categoryOptions}
        selected={selectedCategoryId}
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
    const transactionDate = parseDate(values.transactionDate);
    if (!transactionDate) {
      setError('transactionDate', { message: 'Enter a valid date as YYYY-MM-DD.' });
      return;
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const input = {
        amountMinor,
        categoryId: values.categoryId,
        accountId: values.accountId,
        transactionDate,
        note: values.note.trim() || null,
        paymentMode: values.paymentMode,
      };
      if (!transaction) {
        if (type === 'expense') createExpense(input);
        else createIncome(input);
      } else {
        const updates: UpdateExpenseInput = {};
        const existingAccountId =
          transaction.type === 'expense'
            ? transaction.sourceAccountId
            : transaction.destinationAccountId;
        if (amountMinor !== transaction.amountMinor) updates.amountMinor = amountMinor;
        if (values.categoryId !== transaction.categoryId) updates.categoryId = values.categoryId;
        if (values.accountId !== existingAccountId) updates.accountId = values.accountId;
        if (values.transactionDate !== formatDate(transaction.transactionDate)) {
          updates.transactionDate = transactionDate;
        }
        if (values.note.trim() !== (transaction.note ?? ''))
          updates.note = values.note.trim() || null;
        if (values.paymentMode !== (transaction.paymentMode ?? null)) {
          updates.paymentMode = values.paymentMode;
        }
        if (Object.keys(updates).length === 0) {
          router.back();
          return;
        }
        if (type === 'expense') updateExpense(transaction.id, updates);
        else updateIncome(transaction.id, updates);
      }
      router.back();
    } catch (error) {
      console.error(`Could not create ${type}.`, error);
      setFormError(mapTransactionError(error, type));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}

/**
 * Date, payment mode and note are collapsed by default. Almost every entry
 * takes today's date and no note, and a form that opens with six fields reads
 * as more work than it is.
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
      </View>
    </View>
  );
}

/** Today and yesterday are named; anything else states its date. */
function describeDate(date: Date) {
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startValue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((startToday.getTime() - startValue.getTime()) / 86_400_000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function accountIcon(accountType: string) {
  const key = accountTypeIcon[accountType];
  return isIconName(key) ? key : 'wallet';
}

function accountTypeLabel(accountType: string) {
  return accountType.replace('_', ' ');
}

function formatDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatAmountInput(minorUnits: number) {
  const whole = Math.floor(minorUnits / 100);
  const fraction = String(minorUnits % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

function parseDate(value: string) {
  if (!isValidDate(value)) return null;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateUnchecked(value);
  return parsed !== null && formatDate(parsed) === value;
}

function parseDateUnchecked(value: string) {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapTransactionError(error: unknown, type: EntryType) {
  const message = getUserErrorMessage(error);
  if (message.includes('Archived accounts'))
    return 'This account is archived. Choose an active account.';
  if (message.includes('require a')) return `Choose an ${type} category.`;
  if (message.includes('Amount must')) return 'Enter an amount greater than 0.';
  if (message.includes('was not found'))
    return 'The selected account or category is no longer available.';
  return message;
}

const styles = StyleSheet.create({
  fields: { width: '100%' },
  moreDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.7 },
  centred: { alignSelf: 'center' },
});
