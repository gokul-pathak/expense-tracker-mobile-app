import { router } from 'expo-router';
import { View } from 'react-native';

import { Banner } from '@/components/ui';
import { useCloudSync } from '@/features/sync/sync.provider';
import { useTheme } from '@/theme';

import { SYNC_ATTENTION_NOTE } from './investment-presentation';

/**
 * The global sync state, said where investments are looked at.
 *
 * There is no separate investment sync: this reads the one status every screen
 * shares. It appears only while sync needs attention — the state two devices
 * selling the same units produce — because that is when the figures here may not
 * yet include another device's changes. Nothing here can show a negative holding:
 * a download that would have made one was refused before it reached this device.
 */
export function InvestmentSyncNotice() {
  const { space } = useTheme();
  const { status } = useCloudSync();
  if (status !== 'attention_required') return null;
  return (
    <View style={{ marginTop: space.md }}>
      <Banner
        tone="warning"
        message={SYNC_ATTENTION_NOTE}
        action={{ label: 'Review', onPress: () => router.push('/cloud-sync' as never) }}
      />
    </View>
  );
}
