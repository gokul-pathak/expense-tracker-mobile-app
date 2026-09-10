import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  AmountInput,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScreen,
  Icon,
  isIconName,
  Money,
  PickerSheet,
  SelectorField,
  Skeleton,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import type { Account } from '@/features/accounts/account.types';
import type { Person } from '@/features/people/person.types';
import {
  createBorrow,
  createLend,
  createRepaymentPaid,
  createRepaymentReceived,
  createTransfer,
  getAccountBalance,
  getPerson,
  listActiveAccounts,
  listActivePeople,
} from '@/features/ui/data';
import { getUserErrorMessage } from '@/features/ui/error-message';
import { accountTypeIcon, useTheme } from '@/theme';
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
  const { space } = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  /**
   * What each account actually holds, so choosing where money moves from is an
   * informed choice rather than a guess. Read once per load: the figure is a
   * full aggregate per account, not something to recompute on every keystroke.
   */
  const [balances, setBalances] = useState<Map<number, number>>(new Map());
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
  const currency = source?.currency ?? destination?.currency ?? 'NPR';
  const title = titleFor(type);
  const sameAccount =
    type === 'transfer' &&
    sourceAccountId !== undefined &&
    sourceAccountId === destinationAccountId;
  const mixedCurrency =
    type === 'transfer' &&
    Boolean(source && destination && source.currency !== destination.currency);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    try {
      const nextAccounts = listActiveAccounts();
      setAccounts(nextAccounts);
      setBalances(
        new Map(nextAccounts.map((account) => [account.id, getAccountBalance(account.id)])),
      );
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

  if (loading) {
    return (
      <FormScreen title={title} backIcon="x">
        <MovementSkeleton />
      </FormScreen>
    );
  }
  if (failed) {
    return (
      <FormScreen title={title} backIcon="x">
        <ErrorState
          message="Your local accounts or people could not be read. Your data is safe."
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
          body="This movement has to come from or land in one of your accounts."
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </FormScreen>
    );
  }
  if (needsPerson && !personId && people.length === 0) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="arcs"
          title="Add a person first"
          body="Money given and taken is tracked against a person, so add whoever this is with."
          action={{ label: 'Add Person', onPress: () => router.push('/people/new' as never) }}
        />
      </FormScreen>
    );
  }

  const accountOptions = (exclude?: number): PickerOption<number>[] =>
    accounts
      .filter((account) => !(type === 'transfer' && account.id === exclude))
      .map((account) => ({
        value: account.id,
        label: account.name,
        detail: account.type.replace('_', ' '),
        icon: accountIcon(account.type),
      }));
  const personOptions: PickerOption<number>[] = people.map((item) => ({
    value: item.id,
    label: item.name,
    icon: 'user',
  }));

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: handleSubmit(save), disabled: saving }}
      footer={
        <Button label={saveLabel(type)} large loading={saving} onPress={handleSubmit(save)} />
      }
    >
      {formError ? (
        <View style={{ marginBottom: space.md }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      {ledgerNote(type) ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="info" message={ledgerNote(type) ?? ''} />
        </View>
      ) : null}

      {outstandingMinor !== undefined ? (
        <Card style={[styles.outstanding, { marginBottom: space.lg }]}>
          <Text variant="small" tone="tertiary">
            Outstanding
          </Text>
          <Money minorUnits={outstandingMinor} currency={currency} size="row" showCode={false} />
        </Card>
      ) : null}

      <Controller
        control={control}
        name="amount"
        render={({ field: { onChange, value } }) => (
          <AmountInput
            value={value}
            onChangeText={onChange}
            currency={currency}
            error={errors.amount?.message}
          />
        )}
      />

      {outstandingMinor !== undefined ? (
        <View style={[styles.centred, { marginTop: space.md }]}>
          <Button
            label={'Use full ' + formatMinorUnits(outstandingMinor, currency)}
            variant="text"
            onPress={() =>
              setValue('amount', inputAmount(outstandingMinor), { shouldValidate: true })
            }
          />
        </View>
      ) : null}

      <View style={{ marginTop: space.xl, gap: space.md }}>
        {needsPerson && !personId ? (
          <SelectorField
            label="Person"
            value={person?.name}
            placeholder="Choose person"
            icon="user"
            onPress={() => setSelector('person')}
          />
        ) : null}
        {needsPerson && personId && person ? (
          <SelectorField label="Person" value={person.name} icon="user" disabled onPress={noop} />
        ) : null}

        {sourceLabel ? (
          <SelectorField
            label={sourceLabel}
            value={source?.name}
            placeholder="Choose account"
            icon={source ? accountIcon(source.type) : undefined}
            detail={accountBalanceLabel(source)}
            error={sameAccount ? 'Choose two different accounts.' : undefined}
            onPress={() => setSelector('source')}
          />
        ) : null}

        {sourceLabel && destinationLabel ? <SwapRow onPress={swapAccounts} /> : null}

        {destinationLabel ? (
          <SelectorField
            label={destinationLabel}
            value={destination?.name}
            placeholder="Choose account"
            icon={destination ? accountIcon(destination.type) : undefined}
            detail={accountBalanceLabel(destination)}
            onPress={() => setSelector('destination')}
          />
        ) : null}

        {mixedCurrency ? (
          <Banner
            tone="warning"
            message="Transfers between different currencies are not supported yet."
          />
        ) : null}

        <SelectorField
          label="Date"
          value={dateLabel(date)}
          onPress={() => setShowDatePicker(true)}
        />

        <Controller
          control={control}
          name="note"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextField
              label="Note"
              placeholder="What was this for?"
              multiline
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
            />
          )}
        />
      </View>

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

      <PickerSheet
        visible={selector === 'person'}
        onClose={() => setSelector(null)}
        title="Choose person"
        options={personOptions}
        selected={person?.id}
        onSelect={(id) => setPerson(people.find((item) => item.id === id))}
        footer={{ label: 'Add Person', onPress: () => router.push('/people/new' as never) }}
      />
      <PickerSheet
        visible={selector === 'source'}
        onClose={() => setSelector(null)}
        title="Choose account"
        options={accountOptions(destinationAccountId)}
        selected={sourceAccountId}
        onSelect={setSourceAccountId}
        footer={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
      />
      <PickerSheet
        visible={selector === 'destination'}
        onClose={() => setSelector(null)}
        title="Choose account"
        options={accountOptions(sourceAccountId)}
        selected={destinationAccountId}
        onSelect={setDestinationAccountId}
        footer={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
      />
    </FormScreen>
  );

  /**
   * The balance is stated in the account's own currency, not the form's, since
   * the two can differ and a figure labelled with the wrong currency would be
   * worse than no figure at all.
   */
  function accountBalanceLabel(account?: Account) {
    if (!account) return undefined;
    const balanceMinor = balances.get(account.id);
    if (balanceMinor === undefined) return undefined;
    return formatMinorUnits(balanceMinor, account.currency);
  }

  function swapAccounts() {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSourceAccountId(destinationAccountId);
    setDestinationAccountId(sourceAccountId);
    setFormError('');
  }

  function save(values: Values) {
    if (submitting.current) return;
    const amountMinor = parseMoneyToMinorUnits(values.amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('amount', { message: 'Enter an amount greater than 0.' });
      return;
    }
    if (outstandingMinor !== undefined && amountMinor > outstandingMinor) {
      setError('amount', {
        message: `Amount cannot exceed the outstanding balance of ${formatMinorUnits(outstandingMinor, currency)}.`,
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

/** A circular swap sitting on the hairline between From and To. */
function SwapRow({ onPress }: { onPress: () => void }) {
  const { palette, space, size, motion } = useTheme();
  const rule = { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline };
  return (
    <View style={[styles.swapRow, { gap: space.md }]}>
      <View style={rule} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Swap the two accounts"
        hitSlop={10}
        onPress={onPress}
        style={({ pressed }) => [
          styles.swap,
          {
            width: size.buttonSmall,
            height: size.buttonSmall,
            borderRadius: size.buttonSmall / 2,
            backgroundColor: palette.surfaceRaised,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.hairline,
          },
          pressed && { transform: [{ scale: motion.press.scale }] },
        ]}
      >
        <Icon name="arrow-up-down" size={18} color={palette.textSecondary} />
      </Pressable>
      <View style={rule} />
    </View>
  );
}

function MovementSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <Skeleton width={72} height={12} radius="pill" style={styles.centredSelf} />
      <Skeleton
        width={220}
        height={44}
        radius="pill"
        style={[styles.centredSelf, { marginTop: 14 }]}
      />
      <View style={{ marginTop: space.xxl + space.lg, gap: space.md }}>
        <Skeleton height={size.control} radius={radius.control} />
        <Skeleton height={size.control} radius={radius.control} />
        <Skeleton height={size.control} radius={radius.control} />
      </View>
    </View>
  );
}

/**
 * The correction each of these most needs to make. Lending is not spending and
 * borrowing is not earning — both stay on your books, and someone recording one
 * for the first time will assume otherwise.
 */
function ledgerNote(type: MovementType): string | undefined {
  if (type === 'lend')
    return 'This is not an expense. It stays on your books as money owed to you.';
  if (type === 'borrow') return 'This is not income. It stays on your books as money you owe.';
  if (type === 'transfer')
    return 'A transfer moves money between your accounts. Your total is unchanged.';
  return undefined;
}

function accountIcon(accountType: string) {
  const key = accountTypeIcon[accountType];
  return isIconName(key) ? key : 'wallet';
}

function noop() {}

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
  outstanding: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  centred: { alignItems: 'center' },
  centredSelf: { alignSelf: 'center' },
  swapRow: { flexDirection: 'row', alignItems: 'center' },
  swap: { alignItems: 'center', justifyContent: 'center' },
});
