import { useLocalSearchParams } from 'expo-router';

import { InvalidLink } from '@/features/investments/InvalidLink';
import { TradeForm } from '@/features/investments/TradeForm';
import { parseRouteId } from '@/utils/route-id';

export default function SellInvestmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetId = parseRouteId(id);
  if (assetId === null) return <InvalidLink title="Sell" />;
  return <TradeForm kind="sell" assetId={assetId} />;
}
