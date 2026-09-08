import { router } from 'expo-router';
import { useState } from 'react';

import { AppText, FormScreen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { CloudAuthForm } from '@/features/cloud-auth/CloudAuthForm';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';

export default function SignInScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <FormScreen title="Sign In">
      <AppText color={colors.textMuted}>
        Sign in to your cloud account. This is separate from App Lock, and signing in does not move
        any financial data on its own.
      </AppText>
      <CloudAuthForm
        mode="sign_in"
        saving={saving}
        onSubmit={(values) => void submit(values.email, values.password)}
      />
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
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
