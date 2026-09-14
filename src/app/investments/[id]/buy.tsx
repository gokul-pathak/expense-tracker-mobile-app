import { useLocalSearchParams } from 'expo-router';

import { InvalidLink } from '@/features/investments/InvalidLink';
import { TradeForm } from '@/features/investments/TradeForm';
import { parseRouteId } from '@/utils/route-id';

export default function BuyInvestmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetId = parseRouteId(id);
  if (assetId === null) return <InvalidLink title="Buy" />;
  return <TradeForm kind="buy" assetId={assetId} />;
}
