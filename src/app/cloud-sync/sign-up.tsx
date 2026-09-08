import { router } from 'expo-router';
import { useState } from 'react';

import { AppText, FormScreen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { CloudAuthForm } from '@/features/cloud-auth/CloudAuthForm';
import { cloudAuthService } from '@/features/cloud-auth/auth.service';

export default function SignUpScreen() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  return (
    <FormScreen title="Create Account">
      <AppText color={colors.textMuted}>
        A Cloud Account is optional and is separate from your App Lock PIN.
      </AppText>
      <CloudAuthForm
        mode="sign_up"
        saving={saving}
        onSubmit={(values) => void submit(values.email, values.password)}
      />
      {notice ? <AppText color={colors.success}>{notice}</AppText> : null}
      {error ? <AppText color={colors.danger}>{error}</AppText> : null}
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
