import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  AmountInput,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  FormScreen,
  NativeDataNotice,
  PickerSheet,
  Screen,
  SelectorField,
  Skeleton,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import type { Account } from '@/features/accounts/account.types';
import {
  getAccount,
  getAccountBalance,
  getInvestmentAsset,
  getInvestmentTrade,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
  recordInvestmentDividend,
  updateInvestmentTrade,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

import {
  amountInputText,
  ASSET_TYPE_LABELS,
  describeDividendEffect,
  describeInvestmentError,
  formatAmount,
  formatTradeDate,
  readAmountInput,
} from './investment-presentation';
import type { InvestmentAsset, InvestmentTrade } from './investment.types';

type Kind = 'dividend' | 'fee';

type Loaded = {
  asset: InvestmentAsset;
  accounts: Account[];
  balances: Map<number, number>;
  trade?: InvestmentTrade;
  tradeAccount?: Account;
};

type Props = {
  kind: Kind;
  assetId: number;
  /**
   * Editing this trade. A standalone fee is only ever edited here: it can arrive
   * from another device or a backup, but this app records fees as part of a buy or
   * a sale and offers no separate Add Fee.
   */
  tradeId?: number;
};

/**
 * A dividend: amount, account, date and note.
 *
 * The form says exactly what M10A does with it — cash into the account, and an
 * ordinary income transaction in the Investment Return category — because a
 * dividend is the one investment event that does count as income.
 */
export function CashEventForm({ kind, assetId, tradeId }: Props) {
  const { space, radius, size } = useTheme();
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);
  const [accountId, setAccountId] = useState<number>();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState<'account' | 'date' | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const submitting = useRef(false);
  const filled = useRef(false);
  const editing = tradeId !== undefined;

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      const asset = getInvestmentAsset(assetId);
      const trade = tradeId === undefined ? undefined : getInvestmentTrade(tradeId);
      const accounts = listActiveAccounts().filter(
        (account) => account.currency === asset.currency,
      );
      setLoaded({
        asset,
        accounts,
        balances: new Map(accounts.map((account) => [account.id, getAccountBalance(account.id)])),
        trade,
        tradeAccount: trade ? getAccount(trade.accountId) : undefined,
      });
      if (!filled.current) {
        filled.current = true;
        if (trade) {
          setAccountId(trade.accountId);
          setAmount(amountInputText(trade.amountMinor ?? 0));
          setDate(trade.tradeDate);
          setNote(trade.note ?? '');
        } else if (accounts.length === 1) {
          setAccountId(accounts[0]?.id);
        }
      } else {
        setAccountId((current) =>
          current === undefined ||
          current === trade?.accountId ||
          accounts.some((account) => account.id === current)
            ? current
            : undefined,
        );
      }
    } catch (error) {
      if (__DEV__) console.error('Could not load the dividend form.', error);
      setFailed(true);
    }
  }, [assetId, tradeId]);
  useFocusEffect(load);

  const label = kind === 'dividend' ? 'Dividend' : 'Fee';
  const title = editing ? 'Edit ' + label : 'Record Dividend';

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (failed) {
    return (
      <FormScreen title={title} backIcon="x">
        <ErrorState
          message="We couldn't load this investment. Your data is safe."
          onRetry={load}
          retryLabel="Retry"
        />
      </FormScreen>
    );
  }
  if (loaded === undefined) {
    return (
      <FormScreen title={title} backIcon="x">
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <Skeleton width={220} height={44} radius="pill" />
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={size.control} radius={radius.control} />
          ))}
        </View>
      </FormScreen>
    );
  }

  const { asset } = loaded;
  if (asset.isArchived && !editing) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="ledger"
          title="This investment is archived"
          body="Unarchive it to record new trades. Its holdings and history are unchanged."
          action={{ label: 'Go Back', onPress: () => router.back() }}
        />
      </FormScreen>
    );
  }
  if (loaded.accounts.length === 0 && !editing) {
    return (
      <FormScreen title={title} backIcon="x">
        <EmptyState
          illustration="card"
          title={'Add an account in ' + asset.currency + ' first'}
          body="A dividend is paid into an active account in the investment's own currency. Nothing is converted."
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </FormScreen>
    );
  }

  const { currency } = asset;
  const account =
    loaded.accounts.find((item) => item.id === accountId) ??
    (loaded.tradeAccount?.id === accountId ? loaded.tradeAccount : undefined);
  const balance = account === undefined ? undefined : loaded.balances.get(account.id);
  const amountInput = readAmountInput(amount);
  const accountOptions: PickerOption<number>[] = loaded.accounts.map((item) => {
    const itemBalance = loaded.balances.get(item.id);
    return {
      value: item.id,
      label: item.name,
      detail:
        itemBalance === undefined
          ? undefined
          : formatAmount(itemBalance, item.currency, { code: true }),
    };
  });
  const effect =
    kind === 'dividend'
      ? describeDividendEffect(account?.name).join(' ')
      : 'This fee takes cash from ' +
        (account?.name ?? 'the account you choose') +
        '. It is counted on this investment, never as an expense.';

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: saving }}
      footer={
        <Button
          label={editing ? 'Save Changes' : 'Record Dividend'}
          large
          loading={saving}
          disabled={saving}
          onPress={save}
        />
      }
    >
      {formError ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      <View style={{ gap: space.xs, marginBottom: space.lg }}>
        <Text variant="heading">{asset.name}</Text>
        <Text variant="caption" tone="tertiary">
          {[ASSET_TYPE_LABELS[asset.assetType], asset.symbol, currency].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <AmountInput
        value={amount}
        onChangeText={setAmount}
        currency={currency}
        label={label}
        direction={kind === 'dividend' ? 'income' : 'expense'}
        autoFocus={!editing}
        error={
          amountInput.ok
            ? undefined
            : (amountInput.error ?? (attempted ? 'Enter an amount greater than 0.' : undefined))
        }
      />

      <View style={{ marginTop: space.xl, gap: space.md }}>
        <SelectorField
          label="Account"
          value={account?.name}
          placeholder="Choose account"
          detail={
            balance === undefined ? undefined : formatAmount(balance, currency, { code: true })
          }
          error={attempted && account === undefined ? 'Choose an account.' : undefined}
          onPress={() => setPicking('account')}
        />
        <SelectorField
          label="Date"
          value={formatTradeDate(date)}
          onPress={() => setPicking('date')}
        />
        <TextField
          label="Note"
          value={note}
          onChangeText={setNote}
          placeholder="Optional"
          multiline
        />
      </View>

      <View style={{ marginTop: space.xl }}>
        <Banner tone="info" message={effect} />
      </View>

      {picking === 'date' ? (
        <DateTimePicker
          mode="date"
          maximumDate={new Date()}
          value={date}
          onChange={(_event, value) => {
            setPicking(null);
            if (value) setDate(value);
          }}
        />
      ) : null}

      <PickerSheet
        visible={picking === 'account'}
        onClose={() => setPicking(null)}
        title="Choose account"
        options={accountOptions}
        selected={accountId}
        onSelect={setAccountId}
        emptyMessage={'No active account in ' + currency + '.'}
        footer={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
      />
    </FormScreen>
  );

  /** Guarded, so a second tap cannot record the dividend twice. */
  function save() {
    if (submitting.current || loaded === undefined) return;
    setAttempted(true);
    if (account === undefined || !amountInput.ok) {
      setFormError('Check the highlighted fields.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const figures = {
        amountMinor: amountInput.value,
        tradeDate: date,
        note: note.trim() || null,
      };
      if (loaded.trade) {
        updateInvestmentTrade(loaded.trade.id, {
          ...figures,
          ...(account.id === loaded.trade.accountId ? {} : { accountId: account.id }),
        });
      } else {
        recordInvestmentDividend({ ...figures, assetId, accountId: account.id });
      }
      router.back();
    } catch (error) {
      setFormError(describeInvestmentError(error, loaded.trade ? 'edit' : 'dividend'));
      load();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}
