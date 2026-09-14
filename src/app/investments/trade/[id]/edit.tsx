import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { ErrorState, FormScreen, NativeDataNotice, Screen, Skeleton } from '@/components/ui';
import { CashEventForm } from '@/features/investments/CashEventForm';
import { InvalidLink } from '@/features/investments/InvalidLink';
import { TradeForm } from '@/features/investments/TradeForm';
import type { InvestmentTrade } from '@/features/investments/investment.types';
import { getInvestmentTrade, isLocalFinanceDataAvailable } from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

/**
 * Edits a trade in the form it was recorded with. Its asset and its kind never
 * change — a buy that should have been a sale is deleted and recorded again — so
 * this only has to choose the form.
 */
export default function EditInvestmentTradeScreen() {
  const { space, radius, size } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parseRouteId(id);
  const [trade, setTrade] = useState<InvestmentTrade>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!isLocalFinanceDataAvailable || routeId === null) return;
    setFailed(false);
    try {
      setTrade(getInvestmentTrade(routeId));
    } catch (caught) {
      if (__DEV__) console.error('Could not load trade for editing.', caught);
      setFailed(true);
    }
  }, [routeId]);
  useFocusEffect(load);

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  if (routeId === null) return <InvalidLink title="Edit Trade" />;
  if (failed) {
    return (
      <FormScreen title="Edit Trade" backIcon="x">
        <ErrorState
          title="Trade unavailable"
          message="This trade may have been deleted since you opened it."
          onRetry={load}
          retryLabel="Retry"
        />
      </FormScreen>
    );
  }
  if (trade === undefined || trade.id !== routeId) {
    return (
      <FormScreen title="Edit Trade" backIcon="x">
        <Skeleton height={size.control} radius={radius.control} style={{ marginTop: space.xl }} />
      </FormScreen>
    );
  }
  if (trade.tradeType === 'buy' || trade.tradeType === 'sell') {
    return <TradeForm kind={trade.tradeType} assetId={trade.assetId} tradeId={trade.id} />;
  }
  return <CashEventForm kind={trade.tradeType} assetId={trade.assetId} tradeId={trade.id} />;
}
