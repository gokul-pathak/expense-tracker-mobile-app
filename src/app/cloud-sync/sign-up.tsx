import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, FormScreen, Text } from '@/components/ui';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';
import { CloudAuthForm } from '@/features/cloud-auth/CloudAuthForm';
import { useTheme } from '@/theme';

export default function SignUpScreen() {
  const { space } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  return (
    <FormScreen title="Create Account" backIcon="x">
      <Text variant="body" tone="secondary" style={{ marginTop: space.sm }}>
        An account lets your records reach your other devices. It is optional, and separate from
        your App Lock PIN.
      </Text>

      {notice ? (
        <View style={{ marginTop: space.lg }}>
          <Banner tone="positive" message={notice} />
        </View>
      ) : null}
      {error ? (
        <View style={{ marginTop: space.lg }}>
          <Banner tone="negative" message={error} />
        </View>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <CloudAuthForm
          mode="sign_up"
          saving={saving}
          onSubmit={(values) => void submit(values.email, values.password)}
        />
      </View>

      <View style={{ marginTop: space.xl4 }}>
        <Text variant="caption" tone="tertiary" align="center">
          Creating an account does not upload anything yet. You choose what happens to your data
          when you set up sync.
        </Text>
      </View>
    </FormScreen>
  );

  async function submit(email: string, password: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await cloudAuthService.signUp(email, password);
      if (!result.session) {
        setNotice('Check your email to confirm your account, then sign in.');
        return;
      }
      router.replace('/cloud-sync' as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create an account.');
    } finally {
      setSaving(false);
    }
  }
}
