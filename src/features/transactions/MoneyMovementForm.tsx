import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { AppButton, AppText, FormScreen, ScreenState } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';
import type { Account } from '@/features/accounts/account.types';
import type { Person } from '@/features/people/person.types';
import { getUserErrorMessage } from '@/features/ui/error-message';
import {
  createBorrow,
  createLend,
  createRepaymentPaid,
  createRepaymentReceived,
  createTransfer,
  getPerson,
  listActiveAccounts,
  listActivePeople,
} from '@/features/ui/data';
import { formatMinorUnits, parseMoneyToMinorUnits } from '@/utils/money';

type MovementType = 'transfer' | 'lend' | 'borrow' | 'repayment_received' | 'repayment_paid';
type Selector = 'person' | 'source' | 'destination' | null;
const schema = z.object({
  amount: z.string().superRefine((value, context) => {
    const amount = parseMoneyToMinorUnits(value);
    if (amount === null || amount <= 0) {
      context.addIssue({ code: 'custom', message: 'Enter an amount greater than 0.' });
    }
  }),
  note: z.string(),
});
type Values = z.infer<typeof schema>;

export function MoneyMovementForm({
  type,
  personId,
  outstandingMinor,
}: {
  type: MovementType;
  personId?: number;
  outstandingMinor?: number;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person>();
  const [sourceAccountId, setSourceAccountId] = useState<number>();
  const [destinationAccountId, setDestinationAccountId] = useState<number>();
  const [selector, setSelector] = useState<Selector>(null);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', note: '' },
  });
  const source = accounts.find((account) => account.id === sourceAccountId);
  const destination = accounts.find((account) => account.id === destinationAccountId);
  const needsPerson = type !== 'transfer';
  const sourceLabel = type === 'borrow' || type === 'repayment_received' ? undefined : 'From';
  const destinationLabel = type === 'lend' || type === 'repayment_paid' ? undefined : 'To';

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    try {
      const nextAccounts = listActiveAccounts();
      setAccounts(nextAccounts);
      if (nextAccounts.length === 1) {
        if (sourceLabel) setSourceAccountId(nextAccounts[0]?.id);
        if (destinationLabel) setDestinationAccountId(nextAccounts[0]?.id);
      }
      if (needsPerson) {
        setPeople(listActivePeople());
        if (personId) setPerson(getPerson(personId));
      }
    } catch (error) {
      console.error('Could not load money movement data.', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [destinationLabel, needsPerson, personId, sourceLabel]);
  useFocusEffect(load);

  if (loading)
    return (
      <FormScreen title={titleFor(type)}>
        <ScreenState title="Loading" description="Reading your local accounts and people..." />
      </FormScreen>
    );
  if (failed)
    return (
      <FormScreen title={titleFor(type)}>
        <ScreenState
          title="Could not load details"
          description="Your local data could not be read."
          retry={load}
        />
      </FormScreen>
    );
  if (accounts.length === 0) {
    return (
      <FormScreen title={titleFor(type)}>
        <ScreenState
          title="Add an account first"
          description="An active account is required to record this movement."
        />
        <AppButton label="Add Account" onPress={() => router.push('/accounts/new' as never)} />
      </FormScreen>
    );
  }
  if (needsPerson && !personId && people.length === 0) {
    return (
      <FormScreen title={titleFor(type)}>
        <ScreenState
          title="Add a person first to track money given or taken."
          description="People are required for lending and borrowing."
        />
        <AppButton label="Add Person" onPress={() => router.push('/people/new' as never)} />
      </FormScreen>
    );
  }

  return (
    <FormScreen title={titleFor(type)}>
      <View style={styles.form}>
        {formError ? <AppText color={colors.danger}>{formError}</AppText> : null}
        {person ? <AppText color={colors.textMuted}>{person.name}</AppText> : null}
        {outstandingMinor !== undefined ? (
          <View style={styles.outstanding}>
            <AppText color={colors.textMuted}>Outstanding</AppText>
            <AppText weight="700">
              {formatMinorUnits(
                outstandingMinor,
                source?.currency ?? destination?.currency ?? 'NPR',
              )}
            </AppText>
          </View>
        ) : null}
        <View style={styles.field}>
          <AppText color={colors.textMuted}>
            {source?.currency ?? destination?.currency ?? 'NPR'}
          </AppText>
          <Controller
            control={control}
            name="amount"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                accessibilityLabel="Amount"
                autoFocus
                keyboardType="decimal-pad"
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                style={[styles.amount, errors.amount && styles.inputError]}
                value={value}
              />
            )}
          />
          {errors.amount ? <AppText color={colors.danger}>{errors.amount.message}</AppText> : null}
          {outstandingMinor !== undefined ? (
            <Pressable
              onPress={() =>
                setValue('amount', inputAmount(outstandingMinor), { shouldValidate: true })
              }
            >
              <AppText color={colors.primary} weight="600">
                Use full outstanding amount
              </AppText>
            </Pressable>
          ) : null}
        </View>
        {needsPerson && !personId ? (
          <Picker
            label="Person"
            value={person?.name ?? 'Choose person'}
            onPress={() => setSelector('person')}
          />
        ) : null}
        {sourceLabel ? (
          <Picker
            label={sourceLabel}
            value={source?.name ?? 'Choose account'}
            onPress={() => setSelector('source')}
          />
        ) : null}
        {destinationLabel ? (
          <Picker
            label={destinationLabel}
            value={destination?.name ?? 'Choose account'}
            onPress={() => setSelector('destination')}
          />
        ) : null}
        {type === 'transfer' &&
        source &&
        destination &&
        source.currency !== destination.currency ? (
          <AppText color={colors.danger}>
            Transfers between different currencies are not supported yet.
          </AppText>
        ) : null}
        <Picker label="Date" value={dateLabel(date)} onPress={() => setShowDatePicker(true)} />
        {showDatePicker ? (
          <DateTimePicker
            maximumDate={new Date()}
            mode="date"
            value={date}
            onChange={(_event, value) => {
              setShowDatePicker(false);
              if (value) setDate(value);
            }}
          />
        ) : null}
        <View style={styles.field}>
          <AppText weight="600">Note</AppText>
          <Controller
            control={control}
            name="note"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                accessibilityLabel="Note"
                multiline
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="Optional note"
                placeholderTextColor={colors.textMuted}
                style={styles.note}
                value={value}
              />
            )}
          />
        </View>
        <AppButton
          disabled={saving}
          label={saving ? 'Saving...' : saveLabel(type)}
          onPress={handleSubmit(save)}
        />
      </View>
      <SelectionModal
        visible={selector !== null}
        title={selector === 'person' ? 'Choose person' : 'Choose account'}
        onClose={() => setSelector(null)}
      >
        {selector === 'person'
          ? people.map((item) => (
              <Option
                key={item.id}
                label={item.name}
                onPress={() => {
                  setPerson(item);
                  setSelector(null);
                }}
              />
            ))
          : accounts
              .filter(
                (account) =>
                  !(
                    type === 'transfer' &&
                    ((selector === 'source' && account.id === destinationAccountId) ||
                      (selector === 'destination' && account.id === sourceAccountId))
                  ),
              )
              .map((account) => (
                <Option
                  key={account.id}
                  label={account.name}
                  detail={account.type.replace('_', ' ')}
                  onPress={() => {
                    if (selector === 'source') setSourceAccountId(account.id);
                    else setDestinationAccountId(account.id);
                    setSelector(null);
                  }}
                />
              ))}
        {selector === 'person' ? (
          <AppButton
            label="+ Add Person"
            variant="secondary"
            onPress={() => router.push('/people/new' as never)}
          />
        ) : (
          <AppButton
            label="+ Add Account"
            variant="secondary"
            onPress={() => router.push('/accounts/new' as never)}
          />
        )}
      </SelectionModal>
    </FormScreen>
  );

  function save(values: Values) {
    if (submitting.current) return;
    const amountMinor = parseMoneyToMinorUnits(values.amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('amount', { message: 'Enter an amount greater than 0.' });
      return;
    }
    if (outstandingMinor !== undefined && amountMinor > outstandingMinor) {
      setError('amount', {
        message: `Amount cannot exceed the outstanding balance of ${formatMinorUnits(outstandingMinor, source?.currency ?? destination?.currency ?? 'NPR')}.`,
      });
      return;
    }
    if (type === 'transfer' && sourceAccountId === destinationAccountId) {
      setFormError('Choose two different accounts.');
      return;
    }
    if (type === 'transfer' && source && destination && source.currency !== destination.currency) {
      setFormError('Transfers between different currencies are not supported yet.');
      return;
    }
    const accountId = sourceLabel ? sourceAccountId : destinationAccountId;
    if (!accountId || (needsPerson && !person)) {
      setFormError('Choose all required fields.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const input = {
        amountMinor,
        accountId,
        transactionDate: date,
        note: values.note.trim() || null,
      };
      if (type === 'transfer')
        createTransfer({
          amountMinor,
          sourceAccountId: sourceAccountId!,
          destinationAccountId: destinationAccountId!,
          transactionDate: date,
          note: input.note,
        });
      else if (type === 'lend') createLend({ ...input, personId: person!.id });
      else if (type === 'borrow') createBorrow({ ...input, personId: person!.id });
      else if (type === 'repayment_received')
        createRepaymentReceived({ ...input, personId: person!.id });
      else createRepaymentPaid({ ...input, personId: person!.id });
      router.back();
    } catch (error) {
      setFormError(mapError(getUserErrorMessage(error)));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}

function Picker({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <View style={styles.field}>
      <AppText weight="600">{label}</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${label}`}
        onPress={onPress}
        style={styles.picker}
      >
        <AppText color={value.startsWith('Choose') ? colors.textMuted : colors.text}>
          {value}
        </AppText>
        <AppText color={colors.textMuted}>›</AppText>
      </Pressable>
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
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <AppText variant="heading" weight="700">
              {title}
            </AppText>
            <Pressable onPress={onClose}>
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
function Option({
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
      style={styles.option}
    >
      <AppText weight="600">{label}</AppText>
      {detail ? (
        <AppText variant="caption" color={colors.textMuted}>
          {detail}
        </AppText>
      ) : null}
    </Pressable>
  );
}
function titleFor(type: MovementType) {
  return (
    {
      transfer: 'Transfer',
      lend: 'Money I Gave',
      borrow: 'Money I Took',
      repayment_received: 'Payment Received',
      repayment_paid: 'Repay',
    } as const
  )[type];
}
function saveLabel(type: MovementType) {
  return (
    {
      transfer: 'Transfer',
      lend: 'Save Money Given',
      borrow: 'Save Money Taken',
      repayment_received: 'Save Payment',
      repayment_paid: 'Save Repayment',
    } as const
  )[type];
}
function dateLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
function inputAmount(amount: number) {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
function mapError(message: string) {
  if (message.includes('different')) return 'Choose two different accounts.';
  if (message.includes('cannot exceed')) return message;
  return message;
}
const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  amount: {
    borderBottomWidth: 2,
    borderColor: colors.primary,
    color: colors.text,
    fontSize: 42,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
  inputError: { borderColor: colors.danger },
  note: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  picker: {
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
  outstanding: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.32)' },
  modal: {
    maxHeight: '75%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.background,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  modalList: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  option: {
    minHeight: 56,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
