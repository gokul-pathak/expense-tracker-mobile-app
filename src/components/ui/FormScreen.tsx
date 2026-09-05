import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { colors, spacing } from '@/constants/theme';
import { AppText } from './AppText';
import { Screen } from './Screen';

export function FormScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen scroll contentStyle={styles.content}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <AppText color={colors.primary} weight="600">
              Back
            </AppText>
          </Pressable>
          <AppText variant="title" weight="700">
            {title}
          </AppText>
        </View>
        {children}
      </KeyboardAvoidingView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxxl },
  header: { gap: spacing.md, marginBottom: spacing.xl },
});
