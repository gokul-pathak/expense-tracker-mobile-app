import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorState,
  FormScreen,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import type { InvestmentTradeType } from '@/db/constants';
import { FigureRow } from '@/features/investments/FigureRow';
import {
  deleteTradeCopy,
  describeInvestmentError,
  formatHoldingQuantity,
  formatTradeDate,
  speakAmount,
  tradeAccountLine,
  tradeCashDirection,
} from '@/features/investments/investment-presentation';
import type { AssetHolding, TradeHistoryEntry } from '@/features/investments/investment.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  deleteInvestmentTrade,
  getInvestmentAssetDetail,
  getInvestmentTrade,
  isLocalFinanceDataAvailable,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

const TITLES: Record<InvestmentTradeType, string> = {
  buy: 'Buy',
  sell: 'Sale',
  dividend: 'Dividend',
  fee: 'Fee',
};

/**
 * One trade and the cash it moved, with Edit and Delete.
 *
 * There is no swipe-to-delete anywhere in investments. Deleting an early buy can
 * leave a later sale selling units that were never held, so a delete is a
 * deliberate action behind a confirmation that says so — and the service refuses
 * it outright when later history depends on the trade.
 */
export default function InvestmentTradeScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parseRouteId(id);
  const [loaded, setLoaded] = useState<{ entry: TradeHistoryEntry; asset: AssetHolding }>();
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const removing = useRef(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    if (routeId === null) {
      setFailed(true);
      return;
    }
    setFailed(false);
    try {
      const trade = getInvestmentTrade(routeId);
      const detail = getInvestmentAssetDetail(trade.assetId);
      const entry = detail.history.find((item) => item.id === routeId);
      if (entry === undefined) throw new Error('The trade is missing from its own history.');
      setLoaded({ entry, asset: detail.holding });
    } catch (caught) {
      if (__DEV__) console.error('Could not load trade.', caught);
      setLoaded(undefined);
      setFailed(true);
    }
  }, [routeId]);
  useFocusEffect(load);
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  const current = loaded !== undefined && loaded.entry.id === routeId ? loaded : undefined;

  if (failed) {
    return (
      <FormScreen title="Trade">
        <ErrorState
          title="Trade unavailable"
          message={
            routeId === null
              ? 'This link is invalid.'
              : 'This trade may have been deleted since you opened it.'
          }
          onRetry={routeId === null ? undefined : load}
          retryLabel="Retry"
        />
      </FormScreen>
    );
  }
  if (current === undefined) {
    return (
      <FormScreen title="Trade">
        <View style={{ marginTop: space.lg, gap: space.md, alignItems: 'center' }}>
          <Skeleton width={180} height={32} radius="pill" />
          <Skeleton width={110} height={16} radius="pill" />
        </View>
        <Skeleton height={size.listRow * 5} radius={radius.card} style={{ marginTop: space.xxl }} />
      </FormScreen>
    );
  }

  const { entry, asset } = current;
  const { currency } = entry;
  const title = TITLES[entry.tradeType];
  const copy = deleteTradeCopy(entry);
  const quantityTrade = entry.tradeType === 'buy' || entry.tradeType === 'sell';
  const cashLabel = entry.cashEffect.direction === 'out' ? 'Cash Out' : 'Cash In';

  return (
    <FormScreen
      title={title}
      action={{
        label: 'Edit',
        onPress: () => router.push(('/investments/trade/' + entry.id + '/edit') as never),
      }}
    >
      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={[styles.centred, { marginTop: space.lg, gap: space.sm }]}>
        <Money
          minorUnits={entry.cashEffect.amountMinor}
          currency={currency}
          size="feature"
          direction={tradeCashDirection(entry)}
          align="center"
        />
        <Text variant="body" tone="secondary" align="center">
          {tradeAccountLine(entry)}
        </Text>
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title="Details" />
        <Card>
          <FigureRow label="Investment">
            <Text variant="bodyStrong" align="right">
              {asset.name}
            </Text>
          </FigureRow>
          <FigureRow label="Date">
            <Text variant="body" align="right">
              {formatTradeDate(entry.tradeDate)}
            </Text>
          </FigureRow>
          <FigureRow label="Account">
            <Text variant="body" align="right">
              {entry.accountName ?? 'Unknown account'}
            </Text>
          </FigureRow>
          {quantityTrade ? (
            <>
              <FigureRow label="Quantity">
                <Text variant="body" tabular align="right">
                  {formatHoldingQuantity(entry.quantityMinor ?? 0, asset.assetType, currency)}
                </Text>
              </FigureRow>
              <FigureRow
                label="Unit Price"
                accessibilityLabel={
                  'Unit price, ' + speakAmount(entry.unitPriceMinor ?? 0, currency)
                }
              >
                <Money
                  minorUnits={entry.unitPriceMinor ?? 0}
                  currency={currency}
                  size="row"
                  align="right"
                />
              </FigureRow>
              <FigureRow
                label="Fee"
                accessibilityLabel={'Fee, ' + speakAmount(entry.feeMinor, currency)}
              >
                <Money minorUnits={entry.feeMinor} currency={currency} size="row" align="right" />
              </FigureRow>
            </>
          ) : null}
          <FigureRow
            label={cashLabel}
            divided
            accessibilityLabel={
              cashLabel + ', ' + speakAmount(entry.cashEffect.amountMinor, currency)
            }
          >
            <Money
              minorUnits={entry.cashEffect.amountMinor}
              currency={currency}
              size="row"
              showCode
              align="right"
            />
          </FigureRow>
        </Card>
        <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
          {entry.tradeType === 'dividend'
            ? 'Recorded as Investment Return income.'
            : entry.tradeType === 'fee'
              ? 'Counted on this investment, never as an expense.'
              : 'Moves cash between an account and this investment. It is neither income nor an expense.'}
        </Text>
      </View>

      {entry.note ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader title="Note" />
          <Card>
            <Text variant="body">{entry.note}</Text>
          </Card>
        </View>
      ) : null}

      <View style={[styles.centred, { marginTop: space.xl4 }]}>
        <Button
          label={'Delete ' + title}
          variant="destructive"
          loading={deleting}
          onPress={() => setConfirming(true)}
        />
      </View>

      <Dialog
        visible={confirming}
        title={copy.title}
        message={copy.message}
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
    if (removing.current || current === undefined) return;
    removing.current = true;
    setDeleting(true);
    setError('');
    try {
      deleteInvestmentTrade(current.entry.id);
      setConfirming(false);
      router.back();
    } catch (caught) {
      setConfirming(false);
      setError(describeInvestmentError(caught, 'delete'));
    } finally {
      removing.current = false;
      setDeleting(false);
    }
  }
}

const styles = StyleSheet.create({
  centred: { alignItems: 'center' },
});
