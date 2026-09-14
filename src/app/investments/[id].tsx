import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorState,
  ListRow,
  Money,
  NativeDataNotice,
  NavBar,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { CardListItem } from '@/features/investments/CardListItem';
import { FigureRow } from '@/features/investments/FigureRow';
import { GainLine } from '@/features/investments/GainLine';
import { InvestmentSyncNotice } from '@/features/investments/InvestmentSyncNotice';
import { TradeHistoryRow } from '@/features/investments/TradeHistoryRow';
import {
  ASSET_TYPE_LABELS,
  describeInvestmentError,
  formatAmount,
  formatHoldingQuantity,
  formatLocalDateLabel,
  priceUpdatedLabel,
  speakAmount,
} from '@/features/investments/investment-presentation';
import type { AssetDetail, AssetPerformance } from '@/features/investments/investment.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  archiveInvestmentAsset,
  getInvestmentAssetDetail,
  isLocalFinanceDataAvailable,
  unarchiveInvestmentAsset,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

/**
 * One investment: what is held and what it is worth, the actions that change it,
 * its recent prices, and its history.
 *
 * Everything comes from one `getInvestmentAssetDetail` read. The history is the
 * trades in reverse replay order — the order the domain computes holdings in — so
 * two trades on one day appear in the order they were entered, never re-sorted
 * here. It is virtualized, because an asset's history has no ceiling.
 *
 * A position that is fully sold keeps its realized gain and its history. A
 * position with no price says its value is unavailable and still shows cost basis.
 */
export default function InvestmentDetailScreen() {
  const { palette, space, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parseRouteId(id);
  const [loaded, setLoaded] = useState<AssetDetail>();
  const [failed, setFailed] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changing = useRef(false);
  /**
   * The asset the newest read was for. A read finishing for the asset this screen
   * showed a moment ago must never paint its figures under another asset's name.
   */
  const requested = useRef(routeId);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    requested.current = routeId;
    if (routeId === null) {
      setFailed(true);
      return;
    }
    setFailed(false);
    try {
      const detail = getInvestmentAssetDetail(routeId);
      if (requested.current !== routeId) return;
      setLoaded(detail);
    } catch (caught) {
      if (__DEV__) console.error('Could not load investment.', caught);
      if (requested.current !== routeId) return;
      setLoaded(undefined);
      setFailed(true);
    }
  }, [routeId]);
  useFocusEffect(load);
  // A sync or a restore that changes SQLite refreshes this screen while it is open.
  useRefreshOnSyncedData(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  // Only the asset the route names is ever drawn.
  const current = loaded !== undefined && loaded.holding.assetId === routeId ? loaded : undefined;

  if (failed) {
    return (
      <Chrome>
        <ErrorState
          title="Investment unavailable"
          message={
            routeId === null
              ? 'This link is invalid.'
              : "We couldn't load this investment. It may have been removed on another device."
          }
          onRetry={routeId === null ? undefined : load}
          retryLabel="Retry"
        />
      </Chrome>
    );
  }
  if (current === undefined) {
    return (
      <Chrome>
        <DetailSkeleton />
      </Chrome>
    );
  }

  const { holding, history, recentPrices, priceCount } = current;
  const { assetId, currency, assetType } = holding;
  const open = holding.status === 'priced' || holding.status === 'unpriced';
  const go = (path: string) => router.push(('/investments/' + assetId + path) as never);

  const header = (
    <View>
      <Text variant="title">{holding.name}</Text>
      <Text variant="body" tone="tertiary" style={{ marginTop: space.xs }}>
        {[ASSET_TYPE_LABELS[assetType], holding.symbol, currency].filter(Boolean).join(' · ')}
      </Text>

      <InvestmentSyncNotice />
      {error ? (
        <View style={{ marginTop: space.md }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}
      {holding.isArchived ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="info"
            message="This investment is archived. Its holdings and history still count, but new trades can't be recorded."
            action={{ label: 'Unarchive', onPress: unarchive }}
          />
        </View>
      ) : null}
      {holding.status === 'invalid' ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="negative"
            message="This investment's history sells more than it held at some point, so no figures are shown. Correct or delete the sale that caused it."
          />
        </View>
      ) : null}

      <Card hero style={{ marginTop: space.lg }}>
        <ValueBlock holding={holding} onAddPrice={() => go('/price')} />
        <View style={{ marginTop: space.md }}>
          {open ? (
            <>
              <FigureRow
                label="Quantity Held"
                divided
                accessibilityLabel={
                  'Quantity held, ' +
                  formatHoldingQuantity(holding.quantityMinor, assetType, currency)
                }
              >
                <Text variant="bodyStrong" tabular align="right">
                  {formatHoldingQuantity(holding.quantityMinor, assetType, currency)}
                </Text>
              </FigureRow>
              {holding.averageUnitCostMinor !== null ? (
                <FigureRow
                  label="Average Cost"
                  accessibilityLabel={
                    'Average cost, ' + speakAmount(holding.averageUnitCostMinor, currency)
                  }
                >
                  <Money
                    minorUnits={holding.averageUnitCostMinor}
                    currency={currency}
                    size="row"
                    align="right"
                  />
                </FigureRow>
              ) : null}
              <FigureRow
                label="Cost Basis"
                accessibilityLabel={'Cost basis, ' + speakAmount(holding.costBasisMinor, currency)}
              >
                <Money
                  minorUnits={holding.costBasisMinor}
                  currency={currency}
                  size="row"
                  align="right"
                />
              </FigureRow>
              <FigureRow
                label="Current Price"
                accessibilityLabel={
                  holding.latestPrice === null
                    ? 'Current price, none'
                    : 'Current price, ' +
                      speakAmount(holding.latestPrice.priceMinor, currency) +
                      ', ' +
                      priceUpdatedLabel(holding.latestPrice.priceDate)
                }
              >
                {holding.latestPrice === null ? (
                  <Text variant="caption" tone="tertiary" align="right">
                    No current price
                  </Text>
                ) : (
                  <>
                    <Money
                      minorUnits={holding.latestPrice.priceMinor}
                      currency={currency}
                      size="row"
                      align="right"
                    />
                    <Text variant="caption" tone="tertiary" align="right">
                      {priceUpdatedLabel(holding.latestPrice.priceDate)}
                    </Text>
                  </>
                )}
              </FigureRow>
              <FigureRow label="Unrealized Gain/Loss">
                {holding.unrealizedGainMinor === null ? (
                  <Text variant="caption" tone="tertiary" align="right">
                    Unavailable
                  </Text>
                ) : (
                  <GainLine
                    minorUnits={holding.unrealizedGainMinor}
                    currency={currency}
                    kind="unrealized"
                    align="right"
                    size="body"
                  />
                )}
              </FigureRow>
            </>
          ) : null}
          {holding.status !== 'invalid' && holding.tradeCount > 0 ? (
            <FigureRow label="Realized Gain/Loss" divided={!open}>
              <GainLine
                minorUnits={holding.realizedGainMinor}
                currency={currency}
                kind="realized"
                align="right"
                size="body"
              />
            </FigureRow>
          ) : null}
          {holding.dividendsMinor > 0 ? (
            <FigureRow
              label="Dividends"
              accessibilityLabel={'Dividends, ' + speakAmount(holding.dividendsMinor, currency)}
            >
              <Money
                minorUnits={holding.dividendsMinor}
                currency={currency}
                size="row"
                align="right"
              />
            </FigureRow>
          ) : null}
          {holding.otherFeesMinor > 0 ? (
            <FigureRow
              label="Other Fees"
              accessibilityLabel={'Other fees, ' + speakAmount(holding.otherFeesMinor, currency)}
            >
              <Money
                minorUnits={holding.otherFeesMinor}
                currency={currency}
                size="row"
                align="right"
              />
            </FigureRow>
          ) : null}
        </View>
      </Card>

      <View style={[styles.actions, { marginTop: space.lg, gap: space.sm }]}>
        {holding.isArchived ? null : (
          <>
            <View style={styles.action}>
              <Button label="Buy" icon="plus" onPress={() => go('/buy')} />
            </View>
            <View style={styles.action}>
              <Button
                label="Sell"
                icon="minus"
                variant="secondary"
                disabled={!open}
                onPress={() => go('/sell')}
              />
            </View>
            <View style={styles.action}>
              <Button label="Record Dividend" variant="secondary" onPress={() => go('/dividend')} />
            </View>
          </>
        )}
        <View style={styles.action}>
          <Button label="Update Price" variant="secondary" onPress={() => go('/price')} />
        </View>
      </View>

      {priceCount > 0 ? (
        <View style={{ marginTop: space.xxl }}>
          <SectionHeader
            title="Prices"
            trailing={
              <Text variant="caption" tone="tertiary">
                {priceCount === 1 ? '1 price' : priceCount + ' prices'}
              </Text>
            }
          />
          <Card padding="none">
            {recentPrices.map((price, index) => (
              <ListRow
                key={price.id}
                label={formatLocalDateLabel(price.priceDate)}
                value={formatAmount(price.priceMinor, currency, { code: true })}
                valueTone="primary"
                last={index === recentPrices.length - 1}
                onPress={() => go('/price?priceId=' + price.id)}
                accessibilityLabel={
                  'Price on ' +
                  formatLocalDateLabel(price.priceDate) +
                  ', ' +
                  speakAmount(price.priceMinor, currency) +
                  '. Edit price.'
                }
              />
            ))}
          </Card>
          {priceCount > recentPrices.length ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
              {'Showing the ' + recentPrices.length + ' most recent of ' + priceCount + ' prices.'}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader
          title="History"
          trailing={
            history.length > 0 ? (
              <Text variant="caption" tone="tertiary">
                {history.length === 1 ? '1 trade' : history.length + ' trades'}
              </Text>
            ) : undefined
          }
        />
      </View>
    </View>
  );

  const footer = (
    <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
      {holding.isArchived ? (
        <Button label="Unarchive Investment" variant="text" disabled={busy} onPress={unarchive} />
      ) : (
        <Button
          label="Archive Investment"
          variant="text"
          disabled={busy}
          onPress={() => setConfirmingArchive(true)}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Investment" onBack={() => router.back()} />
      <FlatList
        data={history}
        keyExtractor={(trade) => String(trade.id)}
        renderItem={({ item, index }) => (
          <CardListItem first={index === 0} last={index === history.length - 1}>
            <TradeHistoryRow
              trade={item}
              assetType={assetType}
              last={index === history.length - 1}
              onPress={() => router.push(('/investments/trade/' + item.id) as never)}
            />
          </CardListItem>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Card>
            <Text variant="body" tone="secondary">
              No trades yet. Record a buy to start this holding.
            </Text>
          </Card>
        }
        ListFooterComponent={footer}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.xxl,
        }}
        initialNumToRender={10}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
      <Dialog
        visible={confirmingArchive}
        title="Archive this investment?"
        message="It moves to Archived and no new trades can be recorded. Its holdings, gains and history are kept and still count."
        confirmLabel="Archive"
        loading={busy}
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={archive}
      />
    </SafeAreaView>
  );

  /** Guarded, so a second tap cannot archive twice. */
  function archive() {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      archiveInvestmentAsset(assetId);
      setConfirmingArchive(false);
      load();
    } catch (caught) {
      setConfirmingArchive(false);
      setError(describeInvestmentError(caught, 'asset'));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  function unarchive() {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      unarchiveInvestmentAsset(assetId);
      load();
    } catch (caught) {
      setError(describeInvestmentError(caught, 'asset'));
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }
}

/**
 * The one large figure: what the holding is worth. When that is not known, the
 * block says why in words, and never shows zero in its place.
 */
function ValueBlock({
  holding,
  onAddPrice,
}: {
  holding: AssetPerformance;
  onAddPrice: () => void;
}) {
  const { space } = useTheme();
  switch (holding.status) {
    case 'priced':
      return (
        <View
          accessible
          accessibilityLabel={
            'Current value, ' + speakAmount(holding.marketValueMinor ?? 0, holding.currency)
          }
        >
          <Text variant="eyebrow" tone="tertiary">
            Current Value
          </Text>
          <Money
            minorUnits={holding.marketValueMinor ?? 0}
            currency={holding.currency}
            size="hero"
            style={{ marginTop: space.sm }}
          />
        </View>
      );
    case 'unpriced':
      return (
        <View>
          <Text variant="eyebrow" tone="tertiary">
            Current Value
          </Text>
          <Text variant="heading" tone="secondary" style={{ marginTop: space.sm }}>
            Current value unavailable
          </Text>
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
            No price has been entered for this investment. Its cost basis is shown below.
          </Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button label="Add Price" variant="secondary" small onPress={onAddPrice} />
          </View>
        </View>
      );
    case 'closed':
      return (
        <View>
          <Text variant="eyebrow" tone="tertiary">
            Current Value
          </Text>
          <Text variant="heading" tone="secondary" style={{ marginTop: space.sm }}>
            {holding.tradeCount === 0 ? 'No trades yet' : 'No current holdings'}
          </Text>
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
            {holding.tradeCount === 0
              ? 'Record a buy to start this holding.'
              : 'Everything was sold. Its realized gain and history are kept.'}
          </Text>
        </View>
      );
    case 'invalid':
      return (
        <View>
          <Text variant="eyebrow" tone="tertiary">
            Current Value
          </Text>
          <Text variant="heading" tone="negative" style={{ marginTop: space.sm }}>
            Figures unavailable
          </Text>
        </View>
      );
  }
}

function Chrome({ children }: { children: ReactNode }) {
  const { palette, gutter, space } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Investment" onBack={() => router.back()} />
      <View style={[styles.fill, { paddingHorizontal: gutter, paddingTop: space.sm }]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

function DetailSkeleton() {
  const { space, radius, size } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Skeleton width={200} height={28} radius="pill" />
      <Skeleton width={140} height={14} radius="pill" />
      <Skeleton height={260} radius={radius.heroCard} style={{ marginTop: space.md }} />
      <Skeleton height={size.button * 2 + space.sm} radius={radius.control} />
      <Skeleton height={size.transactionRow * 3} radius={radius.card} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: '45%' },
});
