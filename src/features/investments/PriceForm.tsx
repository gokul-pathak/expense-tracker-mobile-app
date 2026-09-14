import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  AmountInput,
  Banner,
  Button,
  Dialog,
  ErrorState,
  FormScreen,
  NativeDataNotice,
  Screen,
  SelectorField,
  Skeleton,
  Text,
} from '@/components/ui';
import {
  addInvestmentPrice,
  deleteInvestmentPrice,
  getInvestmentAsset,
  getInvestmentPrice,
  isLocalFinanceDataAvailable,
  updateInvestmentPrice,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

import {
  amountInputText,
  ASSET_TYPE_LABELS,
  dateOfLocalDate,
  describeInvestmentError,
  formatLocalDateLabel,
  localDateText,
  PRICE_EFFECT_NOTE,
  readAmountInput,
} from './investment-presentation';
import type { InvestmentAsset, InvestmentPrice } from './investment.types';

type Props = {
  assetId: number;
  /** Editing this manual price rather than adding one. */
  priceId?: number;
};

/**
 * A manual price for one calendar day, in the asset's own currency.
 *
 * A price moves no money: the account balance, income and expense all stay as they
 * were, and only the current value and unrealized gain change. The currency is
 * fixed by the asset, so it is shown and never chosen.
 */
export function PriceForm({ assetId, priceId }: Props) {
  const { space, radius, size } = useTheme();
  const [loaded, setLoaded] = useState<{ asset: InvestmentAsset; price?: InvestmentPrice }>();
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState('');
  const submitting = useRef(false);
  const filled = useRef(false);
  const editing = priceId !== undefined;

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      const asset = getInvestmentAsset(assetId);
      const price = priceId === undefined ? undefined : getInvestmentPrice(priceId);
      if (price !== undefined && price.assetId !== asset.id) {
        throw new Error('The price belongs to another investment.');
      }
      setLoaded({ asset, price });
      if (!filled.current && price) {
        setAmount(amountInputText(price.priceMinor));
        setDate(dateOfLocalDate(price.priceDate));
      }
      filled.current = true;
    } catch (error) {
      if (__DEV__) console.error('Could not load the price form.', error);
      setFailed(true);
    }
  }, [assetId, priceId]);
  useFocusEffect(load);

  const title = editing ? 'Edit Price' : 'Update Price';

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
          message="We couldn't load this price. Your data is safe."
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
          <Skeleton height={size.control} radius={radius.control} />
        </View>
      </FormScreen>
    );
  }

  const { asset } = loaded;
  const amountInput = readAmountInput(amount);
  const busy = saving || deleting;

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: busy }}
      footer={<Button label="Save Price" large loading={saving} disabled={busy} onPress={save} />}
    >
      {formError ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      <View style={{ gap: space.xs, marginBottom: space.lg }}>
        <Text variant="heading">{asset.name}</Text>
        <Text variant="caption" tone="tertiary">
          {[ASSET_TYPE_LABELS[asset.assetType], asset.symbol, asset.currency]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <AmountInput
        value={amount}
        onChangeText={setAmount}
        currency={asset.currency}
        label="Price per unit"
        autoFocus={!editing}
        error={
          amountInput.ok
            ? undefined
            : (amountInput.error ?? (attempted ? 'Enter a price greater than 0.' : undefined))
        }
      />

      <View style={{ marginTop: space.xl, gap: space.md }}>
        <SelectorField
          label="Price Date"
          value={formatLocalDateLabel(localDateText(date))}
          onPress={() => setShowDatePicker(true)}
        />
      </View>

      <Text variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
        {PRICE_EFFECT_NOTE}
      </Text>

      {editing ? (
        <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
          <Button
            label="Delete Price"
            variant="destructive"
            disabled={busy}
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : null}

      {showDatePicker ? (
        <DateTimePicker
          mode="date"
          maximumDate={new Date()}
          value={date}
          onChange={(_event, value) => {
            setShowDatePicker(false);
            if (value) setDate(value);
          }}
        />
      ) : null}

      <Dialog
        visible={confirming}
        title="Delete this price?"
        message="The investment is valued at the latest price before it, or shown without a current value if there is none. No cash moves."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </FormScreen>
  );

  /** Guarded, so a second tap cannot save the price twice. */
  function save() {
    if (submitting.current || loaded === undefined) return;
    setAttempted(true);
    if (!amountInput.ok) {
      setFormError('Enter a price greater than 0.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const input = { priceMinor: amountInput.value, priceDate: localDateText(date) };
      if (loaded.price) updateInvestmentPrice(loaded.price.id, input);
      else addInvestmentPrice({ ...input, assetId: loaded.asset.id });
      router.back();
    } catch (error) {
      setFormError(describeInvestmentError(error, 'price'));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function remove() {
    if (!loaded?.price || submitting.current) return;
    submitting.current = true;
    setDeleting(true);
    try {
      deleteInvestmentPrice(loaded.price.id);
      setConfirming(false);
      router.back();
    } catch (error) {
      setConfirming(false);
      setFormError(describeInvestmentError(error, 'price'));
    } finally {
      submitting.current = false;
      setDeleting(false);
    }
  }
}
