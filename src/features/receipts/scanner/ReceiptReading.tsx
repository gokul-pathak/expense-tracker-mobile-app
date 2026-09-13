import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Reading receipt…
 *
 * An indeterminate indicator and nothing that pretends to know how far along
 * it is. An OCR engine reports no progress, so a percentage here would be
 * invented — and a bar that sits at 73% is worse than no bar at all.
 */
export function ReceiptReading() {
  const { palette, space } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Reading receipt"
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={[styles.reading, { paddingVertical: space.xl6, gap: space.lg }]}
    >
      <ActivityIndicator color={palette.accent} />
      <Text variant="heading" align="center">
        Reading receipt…
      </Text>
      <Text variant="body" tone="secondary" align="center">
        Finding the total, the date and the shop. Nothing is saved yet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  reading: { alignItems: 'center' },
});
