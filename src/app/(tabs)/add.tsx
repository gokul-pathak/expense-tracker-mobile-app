import { StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

const actions = [
  ['Add Expense', 'Milestone 2'],
  ['Add Income', 'Milestone 2'],
  ['Transfer', 'Milestone 4'],
  ['Lend / Borrow', 'Milestone 4'],
] as const;

export default function AddScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Quick Add
        </AppText>
        <AppText color={colors.textMuted}>
          This establishes the intended entry point without implementing financial records yet.
        </AppText>
      </View>

      <Card style={styles.card}>
        {actions.map(([label, milestone]) => (
          <View key={label} style={styles.action}>
            <AppButton label={label} disabled />
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
  card: {
    gap: spacing.lg,
  },
  action: {
    gap: spacing.xs,
  },
});
