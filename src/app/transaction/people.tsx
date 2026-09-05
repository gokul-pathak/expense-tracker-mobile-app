import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppButton, AppText, Card, NativeDataNotice, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';

export default function LendBorrowChooserScreen() {
  if (!isLocalFinanceDataAvailable)
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  return (
    <Screen>
      <View style={styles.content}>
        <AppText variant="title" weight="700">
          Lend / Borrow
        </AppText>
        <Card style={styles.card}>
          <AppText variant="heading" weight="700">
            Money I Gave
          </AppText>
          <AppText color={colors.textMuted}>You gave money to someone temporarily.</AppText>
          <AppButton
            label="Record Money Given"
            onPress={() => router.push('/transaction/lend/new' as never)}
          />
        </Card>
        <Card style={styles.card}>
          <AppText variant="heading" weight="700">
            Money I Took
          </AppText>
          <AppText color={colors.textMuted}>You borrowed money from someone.</AppText>
          <AppButton
            label="Record Money Taken"
            variant="secondary"
            onPress={() => router.push('/transaction/borrow/new' as never)}
          />
        </Card>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({ content: { gap: spacing.lg }, card: { gap: spacing.md } });
