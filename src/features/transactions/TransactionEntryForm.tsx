import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Controller, useForm } from 'react-hook-form';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { AppButton, AppText, FormScreen, ScreenState } from '@/components/ui';
import { colors, radii, spacing, typography } from '@/constants/theme';
import { PAYMENT_MODES, type PaymentMode } from '@/db/constants';
import type { Account } from '@/features/accounts/account.types';
import type { Category } from '@/features/categories/category.types';
import { getUserErrorMessage } from '@/features/ui/error-message';
import {
  createExpense,
  createIncome,
  listActiveAccounts,
  listExpenseCategories,
  listIncomeCategories,
} from '@/features/ui/data';
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

export function TransactionEntryForm({ type }: { type: EntryType }) {
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
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
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
      amount: '',
      transactionDate: formatDate(new Date()),
      note: '',
      paymentMode: null,
    },
  });

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const title = type === 'expense' ? 'Add Expense' : 'Add Income';
  const categoryLabel = type === 'expense' ? 'Category' : 'Source';

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    try {
      const nextAccounts = listActiveAccounts();
      setAccounts(nextAccounts);
      setCategories(type === 'expense' ? listExpenseCategories() : listIncomeCategories());
      if (nextAccounts.length === 1 && nextAccounts[0]) {
        setValue('accountId', nextAccounts[0].id);
        setSelectedAccountId(nextAccounts[0].id);
      }
    } catch (error) {
      console.error('Could not load transaction entry data.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [setValue, type]);
  useFocusEffect(load);

  if (loading) {
    return (
      <FormScreen title={title}>
        <ScreenState title="Loading" description="Reading your local accounts and categories..." />
      </FormScreen>
    );
  }
  if (failed) {
    return (
      <FormScreen title={title}>
        <ScreenState
          title="Could not load transaction details"
          description="Your local accounts or categories could not be read."
          retry={load}
        />
      </FormScreen>
    );
  }
  if (accounts.length === 0) {
    return (
      <FormScreen title={title}>
        <ScreenState
          title={`You need an account before adding ${type === 'expense' ? 'an expense' : 'income'}.`}
          description="Add an active account to record where this money came from or went."
        />
        <AppButton label="Add Account" onPress={() => router.push('/accounts/new' as never)} />
      </FormScreen>
    );
  }
  if (categories.length === 0) {
    return (
      <FormScreen title={title}>
        <ScreenState
          title={`No ${type} categories available.`}
          description="Add a category before recording this transaction."
        />
        <AppButton label="Go to Categories" onPress={() => router.push('/categories' as never)} />
      </FormScreen>
    );
  }

  return (
    <FormScreen title={title}>
      <View style={styles.form}>
        {formError ? <AppText color={colors.danger}>{formError}</AppText> : null}
        <View style={styles.amountBlock}>
          <AppText color={colors.textMuted}>{selectedAccount?.currency ?? 'NPR'}</AppText>
          <Controller
            control={control}
            name="amount"
            render={({ field: { onBlur, onChange, value } }) => (
              <TextInput
                accessibilityLabel="Amount"
                autoFocus
                keyboardType="decimal-pad"
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                style={[styles.amountInput, errors.amount && styles.inputError]}
                value={value}
              />
            )}
          />
          {errors.amount ? <AppText color={colors.danger}>{errors.amount.message}</AppText> : null}
        </View>

        <SelectorRow
          label={categoryLabel}
          value={
            selectedCategory
              ? `${selectedCategory.icon ?? '•'}  ${selectedCategory.name}`
              : 'Choose category'
          }
          error={errors.categoryId?.message}
          onPress={() => setSelector('category')}
        />
        <SelectorRow
          label="Account"
          value={
            selectedAccount
              ? `${selectedAccount.icon ?? '•'}  ${selectedAccount.name}`
              : 'Choose account'
          }
          detail={selectedAccount?.type.replace('_', ' ')}
          error={errors.accountId?.message}
          onPress={() => setSelector('account')}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More details"
          accessibilityState={{ expanded: moreDetails }}
          onPress={() => setMoreDetails((expanded) => !expanded)}
          style={styles.moreDetails}
        >
          <AppText weight="600">More Details</AppText>
          <AppText color={colors.textMuted}>{moreDetails ? '⌃' : '›'}</AppText>
        </Pressable>

        {moreDetails ? (
          <View style={styles.details}>
            <SelectorRow
              label="Date"
              value={formatDate(selectedDate)}
              error={errors.transactionDate?.message}
              onPress={() => setShowDatePicker(true)}
            />
            {showDatePicker ? (
              <DateTimePicker
                maximumDate={new Date()}
                mode="date"
                onChange={(_event, date) => {
                  setShowDatePicker(false);
                  if (!date) return;
                  setSelectedDate(date);
                  setValue('transactionDate', formatDate(date), { shouldValidate: true });
                }}
                value={selectedDate}
              />
            ) : null}
            <Field
              control={control}
              name="note"
              label="Note"
              placeholder="Optional note"
              multiline
            />
            <SelectorRow
              label="Payment Mode"
              value={selectedPaymentMode ? paymentModeLabels[selectedPaymentMode] : 'Optional'}
              onPress={() => setSelector('paymentMode')}
            />
          </View>
        ) : null}

        <AppButton
          label={saving ? 'Saving...' : `Save ${type === 'expense' ? 'Expense' : 'Income'}`}
          disabled={saving}
          onPress={handleSubmit(save)}
        />
      </View>

      <SelectionModal
        visible={selector === 'category'}
        title={`Choose ${categoryLabel.toLowerCase()}`}
        onClose={() => setSelector(null)}
      >
        {categories.map((category) => (
          <SelectionRow
            key={category.id}
            label={`${category.icon ?? '•'}  ${category.name}`}
            onPress={() => {
              setValue('categoryId', category.id, { shouldValidate: true });
              setSelectedCategoryId(category.id);
              setSelector(null);
            }}
          />
        ))}
      </SelectionModal>
      <SelectionModal
        visible={selector === 'account'}
        title="Choose account"
        onClose={() => setSelector(null)}
      >
        {accounts.map((account) => (
          <SelectionRow
            key={account.id}
            label={`${account.icon ?? '•'}  ${account.name}`}
            detail={account.type.replace('_', ' ')}
            onPress={() => {
              setValue('accountId', account.id, { shouldValidate: true });
              setSelectedAccountId(account.id);
              setSelector(null);
            }}
          />
        ))}
        <AppButton
          label="+ Add Account"
          variant="secondary"
          onPress={() => router.push('/accounts/new' as never)}
        />
      </SelectionModal>
      <SelectionModal
        visible={selector === 'paymentMode'}
        title="Payment Mode"
        onClose={() => setSelector(null)}
      >
        <SelectionRow
          label="None"
          onPress={() => {
            setValue('paymentMode', null);
            setSelectedPaymentMode(null);
            setSelector(null);
          }}
        />
        {PAYMENT_MODES.map((mode) => (
          <SelectionRow
            key={mode}
            label={paymentModeLabels[mode]}
            onPress={() => {
              setValue('paymentMode', mode);
              setSelectedPaymentMode(mode);
              setSelector(null);
            }}
          />
        ))}
      </SelectionModal>
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
      if (type === 'expense') createExpense(input);
      else createIncome(input);
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

function Field({
  control,
  name,
  label,
  placeholder,
  multiline = false,
}: {
  control: ReturnType<typeof useForm<FormValues>>['control'];
  name: 'note';
  label: string;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <AppText weight="600">{label}</AppText>
      <Controller
        control={control}
        name={name}
        render={({ field: { onBlur, onChange, value }, fieldState }) => (
          <>
            <TextInput
              accessibilityLabel={label}
              multiline={multiline}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                multiline && styles.noteInput,
                fieldState.error && styles.inputError,
              ]}
              value={value}
            />
            {fieldState.error ? (
              <AppText color={colors.danger}>{fieldState.error.message}</AppText>
            ) : null}
          </>
        )}
      />
    </View>
  );
}

function SelectorRow({
  label,
  value,
  detail,
  error,
  onPress,
}: {
  label: string;
  value: string;
  detail?: string;
  error?: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.field}>
      <AppText weight="600">{label}</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${label}`}
        onPress={onPress}
        style={styles.selector}
      >
        <View style={styles.selectorText}>
          <AppText
            color={
              value.startsWith('Choose') || value === 'Optional' ? colors.textMuted : colors.text
            }
          >
            {value}
          </AppText>
          {detail ? (
            <AppText variant="caption" color={colors.textMuted}>
              {detail}
            </AppText>
          ) : null}
        </View>
        <AppText color={colors.textMuted}>›</AppText>
      </Pressable>
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
    </View>
  );
}

function SelectionModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <AppText variant="heading" weight="700">
              {title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close selector"
              onPress={onClose}
              hitSlop={12}
            >
              <AppText color={colors.primary} weight="600">
                Done
              </AppText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalList}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SelectionRow({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.selectionRow}
    >
      <View>
        <AppText weight="600">{label}</AppText>
        {detail ? (
          <AppText variant="caption" color={colors.textMuted}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  form: { gap: spacing.lg },
  amountBlock: { gap: spacing.xs },
  amountInput: {
    borderBottomWidth: 2,
    borderColor: colors.primary,
    color: colors.text,
    fontSize: 42,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
  field: { gap: spacing.sm },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: typography.body,
  },
  noteInput: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  selector: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  selectorText: { flex: 1, gap: spacing.xs },
  moreDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  details: { gap: spacing.lg, paddingTop: spacing.sm },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.32)' },
  modal: {
    maxHeight: '75%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalList: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  selectionRow: {
    minHeight: 56,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
