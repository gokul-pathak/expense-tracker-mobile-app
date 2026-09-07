import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import { AppButton, AppText, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';
import { useCloudAuth } from '@/features/cloud-auth/auth.provider';

export default function CloudAccountScreen() {
  const { status, user, error } = useCloudAuth();

  return (
    <Screen scroll contentStyle={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="title" weight="700">
          Cloud Account
        </AppText>
        <AppText color={colors.textMuted}>
          Cloud authentication is optional. Your financial data remains local until a future sync
          setup.
        </AppText>
      </View>
      {status === 'unconfigured' ? <Unavailable /> : null}
      {status === 'initializing' ? (
        <Card>
          <AppText>Checking Cloud Account...</AppText>
        </Card>
      ) : null}
      {status === 'error' ? (
        <Card>
          <AppText color={colors.danger}>{error}</AppText>
          <AppText color={colors.textMuted}>Your local financial data is still available.</AppText>
        </Card>
      ) : null}
      {status === 'signed_out' ? <SignedOut /> : null}
      {status === 'signed_in' ? <SignedIn email={user?.email ?? 'Signed-in account'} /> : null}
    </Screen>
  );
}

function Unavailable() {
  return (
    <Card>
      <AppText weight="700">Local Only</AppText>
      <AppText color={colors.textMuted}>
        Cloud Sync is not configured in this build. Your data stays on this device.
      </AppText>
    </Card>
  );
}

function SignedOut() {
  return (
    <Card style={{ gap: spacing.md }}>
      <AppText weight="700">Local Only</AppText>
      <AppText color={colors.textMuted}>
        Your data stays on this device. Signing in does not upload financial records yet.
      </AppText>
      <AppButton label="Sign In" onPress={() => router.push('/cloud-account/sign-in')} />
      <AppButton label="Create Account" onPress={() => router.push('/cloud-account/sign-up')} />
    </Card>
  );
}

function SignedIn({ email }: { email: string }) {
  function confirmSignOut() {
    Alert.alert(
      'Sign out of Cloud Account?',
      'This does not delete or upload any local financial data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => void cloudAuthService.signOut() },
      ],
    );
  }
  return (
    <Card style={{ gap: spacing.md }}>
      <AppText weight="700">Cloud Account</AppText>
      <AppText>{email}</AppText>
      <AppText color={colors.textMuted}>
        Cloud sync setup is not enabled yet. No financial data has been uploaded.
      </AppText>
      <AppButton label="Sign Out" onPress={confirmSignOut} />
    </Card>
  );
}
