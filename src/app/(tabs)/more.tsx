import { StyleSheet, View } from 'react-native';

import { AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

const items = [
  ['Accounts', 'M1'],
  ['People', 'M4'],
  ['Categories', 'M1'],
  ['Settings', 'M1'],
] as const;

export default function MoreScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          More
        </AppText>
        <AppText color={colors.textMuted}>
          Secondary features stay out of the bottom navigation.
        </AppText>
      </View>

      <Card style={styles.list}>
        {items.map(([label, milestone], index) => (
          <View key={label} style={[styles.row, index !== items.length - 1 && styles.divider]}>
            <AppText weight="600">{label}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {milestone}
            </AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  list: {
    paddingVertical: 0,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
