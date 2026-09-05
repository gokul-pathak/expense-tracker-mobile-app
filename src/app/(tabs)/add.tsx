import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

export default function AddScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          Quick Add
        </AppText>
        <AppText color={colors.textMuted}>Record money in or out in a few steps.</AppText>
      </View>

      <Card style={styles.card}>
        <AppButton
          label="Add Expense"
          onPress={() => router.push('/transaction/expense/new' as never)}
        />
        <AppButton
          label="Add Income"
          variant="secondary"
          onPress={() => router.push('/transaction/income/new' as never)}
        />
        <View style={styles.action}>
          <AppButton label="Transfer" disabled />
          <AppText variant="caption" color={colors.textMuted}>
            Coming in Milestone 4
          </AppText>
        </View>
        <View style={styles.action}>
          <AppButton label="Lend / Borrow" disabled />
          <AppText variant="caption" color={colors.textMuted}>
            Coming in Milestone 4
          </AppText>
        </View>
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
