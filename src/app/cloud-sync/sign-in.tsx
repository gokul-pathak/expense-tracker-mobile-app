import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, FormScreen, Text } from '@/components/ui';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';
import { CloudAuthForm } from '@/features/cloud-auth/CloudAuthForm';
import { useTheme } from '@/theme';

export default function SignInScreen() {
  const { space } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  return (
    <FormScreen title="Sign In" backIcon="x">
      <Text variant="body" tone="secondary" style={{ marginTop: space.sm }}>
        Signing in does not move any financial data on its own. Your records stay on this device
        until you set up sync.
      </Text>

      {error ? (
        <View style={{ marginTop: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <CloudAuthForm
          mode="sign_in"
          saving={saving}
          onSubmit={(values) => void submit(values.email, values.password)}
        />
      </View>

      <View style={{ marginTop: space.lg, alignItems: 'center' }}>
        <Button
          label="Forgot password?"
          variant="text"
          onPress={() => router.push('/cloud-sync/forgot-password' as never)}
        />
      </View>

      <View style={{ marginTop: space.xl4, alignItems: 'center' }}>
        <Text variant="caption" tone="tertiary" align="center">
          A cloud account is separate from your App Lock PIN, and is never required to use the app.
        </Text>
      </View>
    </FormScreen>
  );

  async function submit(email: string, password: string) {
    setSaving(true);
    setError('');
    try {
      await cloudAuthService.signIn(email, password);
      router.replace('/cloud-sync' as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally {
      setSaving(false);
    }
  }
}
