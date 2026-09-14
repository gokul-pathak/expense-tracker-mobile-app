import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
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
import type { InvestmentAssetType } from '@/db/constants';
import {
  ADD_ASSET_NOTE,
  ASSET_TYPE_LABELS,
  ASSET_TYPE_ORDER,
  describeInvestmentError,
} from '@/features/investments/investment-presentation';
import { ASSET_NAME_MAX, ASSET_SYMBOL_MAX } from '@/features/investments/investment.validation';
import {
  createInvestmentAsset,
  getAppSettings,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

type CurrencyChoice = { code: string; accountCount: number };

/**
 * Add Investment: a name, an optional symbol, a type and a currency.
 *
 * This only defines the asset. No money moves, no transaction is created and no
 * quantity is held until a buy is recorded against it. A symbol is optional
 * because much of what people own — a fixed deposit, a local fund — has none.
 *
 * The currencies offered are the default currency and those of active accounts,
 * because an investment's cash can only move through an account in its own
 * currency. Nothing is converted.
 */
export default function NewInvestmentScreen() {
  const { space, radius, size } = useTheme();
  const [currencies, setCurrencies] = useState<CurrencyChoice[]>();
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [assetType, setAssetType] = useState<InvestmentAssetType>();
  const [currency, setCurrency] = useState<string>();
  const [picking, setPicking] = useState<'type' | 'currency' | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      const defaultCurrency = getAppSettings().defaultCurrency;
      const accountCounts = new Map<string, number>();
      for (const account of listActiveAccounts()) {
        accountCounts.set(account.currency, (accountCounts.get(account.currency) ?? 0) + 1);
      }
      const codes = [...new Set([defaultCurrency, ...accountCounts.keys()])];
      setCurrencies(codes.map((code) => ({ code, accountCount: accountCounts.get(code) ?? 0 })));
      setCurrency((current) => current ?? defaultCurrency);
    } catch (caught) {
      if (__DEV__) console.error('Could not load investment options.', caught);
      setFailed(true);
    }
  }, []);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (failed) {
    return (
      <FormScreen title="Add Investment" backIcon="x">
        <ErrorState
          message="We couldn't load your accounts. Your data is safe."
          onRetry={load}
          retryLabel="Retry"
        />
      </FormScreen>
    );
  }
  if (currencies === undefined) {
    return (
      <FormScreen title="Add Investment" backIcon="x">
        <View style={{ marginTop: space.lg, gap: space.md }}>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} height={size.control} radius={radius.control} />
          ))}
        </View>
      </FormScreen>
    );
  }

  const chosenCurrency = currencies.find((choice) => choice.code === currency);
  const typeOptions: PickerOption<InvestmentAssetType>[] = ASSET_TYPE_ORDER.map((value) => ({
    value,
    label: ASSET_TYPE_LABELS[value],
  }));
  const currencyOptions: PickerOption<string>[] = currencies.map((choice) => ({
    value: choice.code,
    label: choice.code,
    detail:
      choice.accountCount === 0
        ? 'No account in this currency yet'
        : choice.accountCount === 1
          ? '1 account'
          : choice.accountCount + ' accounts',
  }));
  const nameError = attempted && name.trim() === '' ? 'Enter a name.' : undefined;

  return (
    <FormScreen
      title="Add Investment"
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: saving }}
      footer={
        <Button label="Add Investment" large loading={saving} disabled={saving} onPress={save} />
      }
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={{ gap: space.md }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="ABC Shares"
          maxLength={ASSET_NAME_MAX}
          autoFocus
          error={nameError}
        />
        <TextField
          label="Symbol (optional)"
          value={symbol}
          onChangeText={setSymbol}
          placeholder="ABC"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={ASSET_SYMBOL_MAX}
        />
        <SelectorField
          label="Asset Type"
          value={assetType === undefined ? undefined : ASSET_TYPE_LABELS[assetType]}
          placeholder="Choose a type"
          error={attempted && assetType === undefined ? 'Choose a type.' : undefined}
          onPress={() => setPicking('type')}
        />
        <SelectorField
          label="Currency"
          value={currency}
          placeholder="Choose a currency"
          onPress={() => setPicking('currency')}
        />
      </View>

      <Text variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
        {ADD_ASSET_NOTE}
      </Text>
      {chosenCurrency !== undefined && chosenCurrency.accountCount === 0 ? (
        <Text variant="caption" tone="warning" style={{ marginTop: space.sm }}>
          {'Recording a trade needs an active account in ' + chosenCurrency.code + '.'}
        </Text>
      ) : null}

      <PickerSheet
        visible={picking === 'type'}
        onClose={() => setPicking(null)}
        title="Asset type"
        options={typeOptions}
        selected={assetType}
        onSelect={setAssetType}
      />
      <PickerSheet
        visible={picking === 'currency'}
        onClose={() => setPicking(null)}
        title="Currency"
        options={currencyOptions}
        selected={currency}
        onSelect={setCurrency}
      />
    </FormScreen>
  );

  /** Guarded, so a second tap cannot create the asset twice. */
  function save() {
    if (submitting.current) return;
    setAttempted(true);
    if (name.trim() === '' || assetType === undefined || currency === undefined) {
      setError('Check the highlighted fields.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const asset = createInvestmentAsset({
        name,
        symbol: symbol.trim() || null,
        assetType,
        currency,
      });
      router.replace(('/investments/' + asset.id) as never);
    } catch (caught) {
      setError(describeInvestmentError(caught, 'asset'));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}
