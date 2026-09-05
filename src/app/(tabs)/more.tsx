import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

const items = [
  ['▣', 'Accounts', '/accounts'],
  ['◉', 'People', '/people'],
  ['◇', 'Categories', '/categories'],
  ['⚙', 'Settings', '/settings'],
] as const;

export default function MoreScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          More
        </AppText>
        <AppText color={colors.textMuted}>Manage the essentials of your finance setup.</AppText>
      </View>

      <Card style={styles.list}>
        {items.map(([icon, label, href], index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`Open ${label}`}
            onPress={() => router.push(href as never)}
            style={({ pressed }) => [
              styles.row,
              index !== items.length - 1 && styles.divider,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.rowLabel}>
              <AppText variant="subheading" color={colors.primary}>
                {icon}
              </AppText>
              <AppText weight="600">{label}</AppText>
            </View>
            <AppText color={colors.textMuted}>›</AppText>
          </Pressable>
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
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { backgroundColor: colors.surfaceMuted },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
