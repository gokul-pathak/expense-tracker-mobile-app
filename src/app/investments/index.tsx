import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  NativeDataNotice,
  NavBar,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/components/ui';
import { CardListItem } from '@/features/investments/CardListItem';
import { HoldingRow } from '@/features/investments/HoldingRow';
import { InvestmentSyncNotice } from '@/features/investments/InvestmentSyncNotice';
import { PortfolioSummaryCard } from '@/features/investments/PortfolioSummaryCard';
import {
  HOLDING_SEGMENTS,
  partitionHoldings,
  type HoldingSegment,
} from '@/features/investments/investment-presentation';
import type { PortfolioOverview } from '@/features/investments/investment.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import { getPortfolioOverview, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { useTheme } from '@/theme';

const EMPTY_SEGMENT: Record<HoldingSegment, string> = {
  holdings: 'Nothing is held right now. Investments you have sold in full are under Closed.',
  closed: 'No closed investments. An investment moves here once everything in it is sold.',
  archived: 'No archived investments.',
};

/**
 * The portfolio: one summary per currency, then the holdings.
 *
 * Everything on screen comes from one `getPortfolioOverview` call — every holding
 * and the per-currency summary from a single replay — so this screen adds, values
 * and rounds nothing. The holdings are virtualized, because a portfolio has no
 * ceiling on how many assets it holds.
 *
 * Investment value is never folded into Total Balance, and two currencies are never
 * added together: each has its own card.
 */
export default function InvestmentsScreen() {
  const { space, gutter, radius, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [overview, setOverview] = useState<PortfolioOverview>();
  const [failed, setFailed] = useState(false);
  const [segment, setSegment] = useState<HoldingSegment>('holdings');

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable) return;
    setFailed(false);
    try {
      setOverview(getPortfolioOverview());
    } catch (error) {
      if (__DEV__) console.error('Could not load investments.', error);
      setOverview(undefined);
      setFailed(true);
    }
  }, []);
  useFocusEffect(load);
  // A sync or a restore that changes SQLite refreshes this screen while it is open.
  useRefreshOnSyncedData(load);

  const lists = useMemo(
    () => (overview === undefined ? undefined : partitionHoldings(overview.holdings)),
    [overview],
  );
  const addInvestment = () => router.push('/investments/new' as never);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Chrome>
        <ErrorState
          message="We couldn't load your investments."
          onRetry={load}
          retryLabel="Retry"
        />
      </Chrome>
    );
  }
  if (overview === undefined || lists === undefined) {
    // Shapes only. A portfolio value of zero while the real one is read would be a
    // confident wrong figure about someone's money.
    return (
      <Chrome>
        <View style={{ paddingHorizontal: gutter, paddingTop: space.sm, gap: space.md }}>
          <Skeleton height={210} radius={radius.heroCard} />
          <Skeleton height={36} radius={radius.control} style={{ marginTop: space.lg }} />
          <Skeleton height={68 * 3} radius={radius.card} />
        </View>
      </Chrome>
    );
  }
  if (overview.holdings.length === 0) {
    return (
      <Chrome>
        <EmptyState
          illustration="ledger"
          title="No investments yet."
          body="Add an asset to start tracking your portfolio."
          action={{ label: 'Add Investment', onPress: addInvestment }}
        />
      </Chrome>
    );
  }

  const { summary } = overview;
  const items = lists[segment];
  const invalidCount = summary.invalidAssetIds.length;

  const header = (
    <View style={{ paddingBottom: space.sm }}>
      <InvestmentSyncNotice />
      {invalidCount > 0 ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="negative"
            message={
              (invalidCount === 1 ? '1 investment has' : invalidCount + ' investments have') +
              ' a history that sells more than it held, so it is left out of the totals. Open it to see its trades.'
            }
          />
        </View>
      ) : null}
      <View style={{ marginTop: space.md, gap: space.md }}>
        {summary.currencies.map((currencySummary) => (
          <PortfolioSummaryCard
            key={currencySummary.currency}
            summary={currencySummary}
            prominent={summary.currencies.length === 1}
          />
        ))}
      </View>
      <Text variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
        {(summary.currencies.length > 1
          ? 'Each currency is shown on its own; nothing is converted. '
          : '') +
          'Investment value is kept apart from Total Balance, which counts only the cash in your accounts.'}
      </Text>
      <View style={{ marginTop: space.xl }}>
        <SegmentedControl
          segments={HOLDING_SEGMENTS}
          value={segment}
          onChange={setSegment}
          accessibilityLabel="Which investments to show"
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Investments" onBack={() => router.back()} />
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.assetId)}
        renderItem={({ item, index }) => (
          <CardListItem first={index === 0} last={index === items.length - 1}>
            <HoldingRow
              holding={item}
              last={index === items.length - 1}
              onPress={() => router.push(('/investments/' + item.assetId) as never)}
            />
          </CardListItem>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Card>
            <Text variant="body" tone="secondary">
              {EMPTY_SEGMENT[segment]}
            </Text>
          </Card>
        }
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.xxl }}
        initialNumToRender={12}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
      <View
        style={{
          paddingHorizontal: gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.xl,
        }}
      >
        <Button
          label="Add Investment"
          variant="text"
          icon="plus"
          fullWidth
          onPress={addInvestment}
        />
      </View>
    </SafeAreaView>
  );
}

/** The nav bar stays put while the body loads, fails or is empty. */
function Chrome({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <NavBar title="Investments" onBack={() => router.back()} />
      <View style={styles.fill}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
