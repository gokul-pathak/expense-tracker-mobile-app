import { useLocalSearchParams } from 'expo-router';

import { CashEventForm } from '@/features/investments/CashEventForm';
import { InvalidLink } from '@/features/investments/InvalidLink';
import { parseRouteId } from '@/utils/route-id';

export default function RecordDividendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetId = parseRouteId(id);
  if (assetId === null) return <InvalidLink title="Record Dividend" />;
  return <CashEventForm kind="dividend" assetId={assetId} />;
}
