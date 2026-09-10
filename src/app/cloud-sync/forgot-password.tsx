import { router } from 'expo-router';
import { View } from 'react-native';

import { Banner, Button, EmptyState, FormScreen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Password reset is not wired up yet, so this screen says so plainly rather
 * than showing a form that would appear to send something. A field that
 * silently does nothing is worse than no field.
 */
export default function ForgotPasswordScreen() {
  const { space } = useTheme();

  return (
    <FormScreen title="Forgot Password" backIcon="x">
      <View style={{ marginTop: space.lg }}>
        <Banner
          tone="info"
          message="Resetting a password from inside the app is not available yet."
        />
      </View>

      <EmptyState
        illustration="arcs"
        title="Reset by email instead"
        body="Your cloud account is a standard email and password account. Reset it from the email address you signed up with, then come back and sign in."
        fill={false}
      />

      <View style={{ marginTop: space.lg, alignItems: 'center' }}>
        <Button label="Back to Sign In" variant="secondary" onPress={() => router.back()} />
      </View>

      <Text variant="caption" tone="tertiary" align="center" style={{ marginTop: space.xl4 }}>
        Your financial records are on this device and are not affected by a forgotten password.
      </Text>
    </FormScreen>
  );
}
