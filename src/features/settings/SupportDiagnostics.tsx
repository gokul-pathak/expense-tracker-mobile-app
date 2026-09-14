import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { Card, ListRow, Text } from '@/components/ui';
import { useCloudSync } from '@/features/sync/sync.provider';
import { useTheme } from '@/theme';

import { buildSupportDiagnostics } from './support-diagnostics';

/**
 * Version, schema, platform and sync state, for a bug report. Reads no financial
 * record, so it can never put one on screen.
 */
export function SupportDiagnostics() {
  const { space } = useTheme();
  const { status } = useCloudSync();
  const rows = buildSupportDiagnostics({
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    platform: Platform.OS,
    platformVersion: Platform.Version,
    syncStatus: status,
  });
  return (
    <>
      <Card padding="none">
        {rows.map((row, index) => (
          <ListRow
            key={row.label}
            label={row.label}
            value={row.value}
            chevron={false}
            last={index === rows.length - 1}
          />
        ))}
      </Card>
      <Text variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
        For a bug report. It contains no amounts, names, notes or account details.
      </Text>
    </>
  );
}
