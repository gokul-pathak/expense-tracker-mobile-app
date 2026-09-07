import * as LocalAuthentication from 'expo-local-authentication';

export async function canUseBiometrics() {
  return (
    (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  );
}
export async function authenticateBiometric() {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Personal Expense Tracker',
    disableDeviceFallback: true,
    fallbackLabel: 'Use app PIN',
  });
  if (result.success) return 'success' as const;
  if (result.error === 'user_cancel' || result.error === 'system_cancel')
    return 'cancelled' as const;
  return 'failed' as const;
}
