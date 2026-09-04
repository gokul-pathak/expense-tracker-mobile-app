import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { colors, spacing } from '@/constants/theme';

type Props = {
  title: string;
  description: string;
  milestone?: string;
};

export function PlaceholderScreen({ title, description, milestone = 'M0 Foundation' }: Props) {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" weight="700">
          {title}
        </AppText>
        <AppText color={colors.textMuted}>{description}</AppText>
      </View>

      <Card>
        <AppText variant="caption" color={colors.primary} weight="700">
          {milestone.toUpperCase()}
        </AppText>
        <AppText style={styles.message} color={colors.textMuted}>
          This screen is intentionally a placeholder. Finance logic starts in later milestones.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  message: {
    marginTop: spacing.sm,
  },
});
