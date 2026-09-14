import { useLocalSearchParams } from 'expo-router';

import { InvalidLink } from '@/features/investments/InvalidLink';
import { PriceForm } from '@/features/investments/PriceForm';
import { parseRouteId } from '@/utils/route-id';

export default function InvestmentPriceScreen() {
  const { id, priceId } = useLocalSearchParams<{ id: string; priceId?: string }>();
  const assetId = parseRouteId(id);
  const editingId = priceId === undefined ? undefined : parseRouteId(priceId);
  if (assetId === null || editingId === null) return <InvalidLink title="Update Price" />;
  return <PriceForm assetId={assetId} priceId={editingId} />;
}
