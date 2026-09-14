import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScreen,
  Money,
  NativeDataNotice,
  PickerSheet,
  Screen,
  SectionHeader,
  SelectorField,
  Skeleton,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import type { Account } from '@/features/accounts/account.types';
import {
  buyInvestment,
  getAccount,
  getAccountBalance,
  getInvestmentAsset,
  getInvestmentTrade,
  getSellableQuantity,
  isLocalFinanceDataAvailable,
  listActiveAccounts,
  previewInvestmentBuy,
  previewInvestmentSell,
  sellInvestment,
  updateInvestmentTrade,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

import { FigureRow } from './FigureRow';
import { GainLine } from './GainLine';
import {
  amountInputText,
  ASSET_TYPE_LABELS,
  availableLabel,
  describeBuyEffect,
  describeInvestmentError,
  describeSellEffect,
  formatAmount,
  formatHoldingQuantity,
  formatQuantityLabel,
  formatTradeDate,
  quantityInputText,
  readAmountInput,
  readQuantityInput,
  sellQuantityError,
  speakAmount,
} from './investment-presentation';
import type { InvestmentAsset, InvestmentTrade } from './investment.types';
import type { BuyPreview, SellPreview } from './trade-preview.service';

type Kind = 'buy' | 'sell';

type Loaded = {
  asset: InvestmentAsset;
  /** Active accounts in the asset's currency: the only ones its cash can move through. */
  accounts: Account[];
  balances: Map<number, number>;
  /** Present when editing. */
  trade?: InvestmentTrade;
  /** The edited trade's own account, which may since have been archived. */
  tradeAccount?: Account;
};

type Preview = { buy?: BuyPreview; sell?: SellPreview; error?: string };

type Props = {
  kind: Kind;
  assetId: number;
  /** Editing this trade rather than recording a new one. */
  tradeId?: number;
};

/**
 * Buy or Sell: account, quantity, unit price, fee, date and note, with what the
 * trade will do shown before it is recorded.
 *
 * Every figure under "Before you record" comes from the preview service, which
 * uses the arithmetic and the replay that recording uses — this form multiplies
 * nothing. A sale's available quantity is checked here so the mistake is caught
 * while typing, but the service is what finally refuses an oversell: another
 * device, or a backdated trade, can change the answer between here and Save.
 */
export function TradeForm({ kind, assetId, tradeId }: Props) {
  const { space, radius, size } = useTheme();
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState(false);
  const [accountId, setAccountId] = useState<number>();
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [fee, setFee] = useState('');
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
      // Nothing converts, and cash never moves through an archived account, so
      // the picker offers active accounts in the asset's own currency only. It is
      // re-read on every focus, so an account archived meanwhile disappears.
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
          setQuantity(quantityInputText(trade.quantityMinor ?? 0));
          setUnitPrice(amountInputText(trade.unitPriceMinor ?? 0));
          setFee(trade.feeMinor > 0 ? amountInputText(trade.feeMinor) : '');
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
      if (__DEV__) console.error('Could not load the trade form.', error);
      setFailed(true);
    }
  }, [assetId, tradeId]);
  useFocusEffect(load);

  const available = useMemo(() => {
    if (kind !== 'sell' || loaded === undefined) return null;
    try {
      return getSellableQuantity(assetId, date, { replacingTradeId: tradeId });
    } catch (error) {
      if (__DEV__) console.error('Could not read the quantity available to sell.', error);
      return null;
    }
  }, [kind, loaded, assetId, date, tradeId]);

  const preview = useMemo((): Preview => {
    const quantityValue = readQuantityInput(quantity);
    const priceValue = readAmountInput(unitPrice);
    const feeValue = readAmountInput(fee, { optional: true });
    if (loaded === undefined || !quantityValue.ok || !priceValue.ok || !feeValue.ok) return {};
    const draft = {
      quantityMinor: quantityValue.value,
      unitPriceMinor: priceValue.value,
      feeMinor: feeValue.value,
    };
    try {
      if (kind === 'buy') return { buy: previewInvestmentBuy(draft) };
      return {
        sell: previewInvestmentSell({
          ...draft,
          assetId,
          tradeDate: date,
          replacingTradeId: tradeId,
        }),
      };
    } catch (error) {
      return { error: describeInvestmentError(error, kind) };
    }
  }, [kind, loaded, quantity, unitPrice, fee, assetId, date, tradeId]);

  const title = editing
    ? kind === 'buy'
      ? 'Edit Buy'
      : 'Edit Sale'
    : kind === 'buy'
      ? 'Buy'
      : 'Sell';

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
          <Skeleton width={180} height={22} radius="pill" />
          {[0, 1, 2, 3, 4].map((key) => (
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
          body="An investment's cash moves through an active account in its own currency. Nothing is converted."
          action={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
        />
      </FormScreen>
    );
  }

  const { currency, assetType } = asset;
  const account =
    loaded.accounts.find((item) => item.id === accountId) ??
    (loaded.tradeAccount?.id === accountId ? loaded.tradeAccount : undefined);
  const balance = account === undefined ? undefined : loaded.balances.get(account.id);
  const quantityInput = readQuantityInput(quantity);
  const priceInput = readAmountInput(unitPrice);
  const feeInput = readAmountInput(fee, { optional: true });

  const quantityError = !quantityInput.ok
    ? (quantityInput.error ?? (attempted ? 'Enter a quantity.' : undefined))
    : kind === 'sell' && available !== null
      ? (sellQuantityError(quantityInput.value, available, assetType, currency) ?? undefined)
      : undefined;
  const priceError = priceInput.ok
    ? undefined
    : (priceInput.error ?? (attempted ? 'Enter a unit price.' : undefined));
  const feeError = feeInput.ok ? undefined : (feeInput.error ?? undefined);

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

  const primaryLabel = editing ? 'Save Changes' : kind === 'buy' ? 'Record Buy' : 'Record Sell';

  return (
    <FormScreen
      title={title}
      backIcon="x"
      action={{ label: 'Save', onPress: save, disabled: saving }}
      footer={
        <Button label={primaryLabel} large loading={saving} disabled={saving} onPress={save} />
      }
    >
      {formError ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={formError} />
        </View>
      ) : null}

      <View style={{ gap: space.xs }}>
        <Text variant="heading">{asset.name}</Text>
        <Text variant="caption" tone="tertiary">
          {[ASSET_TYPE_LABELS[assetType], asset.symbol, currency].filter(Boolean).join(' · ')}
        </Text>
        {kind === 'sell' && available !== null ? (
          <Text variant="bodyStrong" tabular style={{ marginTop: space.sm }}>
            {availableLabel(available, assetType, currency)}
          </Text>
        ) : null}
      </View>

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
        <TextField
          label="Quantity"
          value={quantity}
          onChangeText={setQuantity}
          placeholder="0"
          keyboardType="decimal-pad"
          autoCorrect={false}
          error={quantityError}
        />
        <TextField
          label={'Unit Price (' + currency + ')'}
          value={unitPrice}
          onChangeText={setUnitPrice}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoCorrect={false}
          error={priceError}
        />
        <TextField
          label={'Fee (' + currency + ', optional)'}
          value={fee}
          onChangeText={setFee}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoCorrect={false}
          error={feeError}
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

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Before you record" />
        <Card>
          {preview.buy && quantityInput.ok && priceInput.ok ? (
            <BuyFigures
              preview={preview.buy}
              quantityMinor={quantityInput.value}
              unitPriceMinor={priceInput.value}
              currency={currency}
            />
          ) : preview.sell ? (
            <SellFigures preview={preview.sell} asset={asset} />
          ) : (
            <Text variant="body" tone={preview.error ? 'negative' : 'tertiary'}>
              {preview.error ?? 'Enter a quantity and a unit price to see the totals.'}
            </Text>
          )}
        </Card>
        <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
          {kind === 'buy' ? describeBuyEffect(account?.name) : describeSellEffect(account?.name)}
        </Text>
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

  /** Guarded, so a second tap cannot record the trade twice. */
  function save() {
    if (submitting.current || loaded === undefined) return;
    setAttempted(true);
    if (account === undefined || !quantityInput.ok || !priceInput.ok || !feeInput.ok) {
      setFormError('Check the highlighted fields.');
      return;
    }
    if (kind === 'sell' && available !== null) {
      const message = sellQuantityError(quantityInput.value, available, assetType, currency);
      if (message !== null) {
        setFormError(message);
        return;
      }
    }
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      const figures = {
        quantityMinor: quantityInput.value,
        unitPriceMinor: priceInput.value,
        feeMinor: feeInput.value,
        tradeDate: date,
        note: note.trim() || null,
      };
      if (loaded.trade) {
        // The account is sent only when it changed: an edit that leaves an
        // archived account alone is still allowed to fix a typo in the price.
        updateInvestmentTrade(loaded.trade.id, {
          ...figures,
          ...(account.id === loaded.trade.accountId ? {} : { accountId: account.id }),
        });
      } else if (kind === 'buy') {
        buyInvestment({ ...figures, assetId, accountId: account.id });
      } else {
        sellInvestment({ ...figures, assetId, accountId: account.id });
      }
      router.back();
    } catch (error) {
      setFormError(describeInvestmentError(error, loaded.trade ? 'edit' : kind));
      // Whatever refused the trade may have changed what the form can offer.
      load();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
}

function BuyFigures({
  preview,
  quantityMinor,
  unitPriceMinor,
  currency,
}: {
  preview: BuyPreview;
  quantityMinor: number;
  unitPriceMinor: number;
  currency: string;
}) {
  return (
    <>
      <FigureRow label="Quantity × Unit Price">
        <Text variant="body" tabular align="right">
          {formatQuantityLabel(quantityMinor, currency) +
            ' × ' +
            formatAmount(unitPriceMinor, currency)}
        </Text>
      </FigureRow>
      <FigureRow
        label="Purchase Value"
        accessibilityLabel={'Purchase value, ' + speakAmount(preview.grossMinor, currency)}
      >
        <Money minorUnits={preview.grossMinor} currency={currency} size="row" align="right" />
      </FigureRow>
      <FigureRow label="Fee" accessibilityLabel={'Fee, ' + speakAmount(preview.feeMinor, currency)}>
        <Money minorUnits={preview.feeMinor} currency={currency} size="row" align="right" />
      </FigureRow>
      <FigureRow
        label="Total Cash Outflow"
        divided
        accessibilityLabel={
          'Total cash outflow, ' + speakAmount(preview.totalCashOutflowMinor, currency)
        }
      >
        <Money
          minorUnits={preview.totalCashOutflowMinor}
          currency={currency}
          size="row"
          showCode
          align="right"
        />
      </FigureRow>
    </>
  );
}

function SellFigures({ preview, asset }: { preview: SellPreview; asset: InvestmentAsset }) {
  const { currency, assetType } = asset;
  return (
    <>
      <FigureRow
        label="Gross Proceeds"
        accessibilityLabel={'Gross proceeds, ' + speakAmount(preview.grossMinor, currency)}
      >
        <Money minorUnits={preview.grossMinor} currency={currency} size="row" align="right" />
      </FigureRow>
      <FigureRow label="Fee" accessibilityLabel={'Fee, ' + speakAmount(preview.feeMinor, currency)}>
        <Money minorUnits={preview.feeMinor} currency={currency} size="row" align="right" />
      </FigureRow>
      <FigureRow
        label="Net Cash Received"
        divided
        accessibilityLabel={
          'Net cash received, ' + speakAmount(preview.netCashReceivedMinor, currency)
        }
      >
        <Money
          minorUnits={preview.netCashReceivedMinor}
          currency={currency}
          size="row"
          showCode
          align="right"
        />
      </FigureRow>
      <FigureRow label="Estimated Realized Gain/Loss">
        {preview.realizedGainMinor === null ? (
          <Text variant="caption" tone="tertiary" align="right">
            Unavailable
          </Text>
        ) : (
          <GainLine
            minorUnits={preview.realizedGainMinor}
            currency={currency}
            kind="realized"
            align="right"
            size="body"
          />
        )}
      </FigureRow>
      <FigureRow label="Remaining Quantity">
        <Text variant="body" tabular align="right">
          {preview.remainingQuantityMinor === null
            ? 'Unavailable'
            : formatHoldingQuantity(preview.remainingQuantityMinor, assetType, currency)}
        </Text>
      </FigureRow>
    </>
  );
}
