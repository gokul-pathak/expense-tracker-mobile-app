import { type PropsWithChildren, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppButton, AppText, Screen } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';

import type { LockConfig } from './app-lock.types';
import { getLockConfig, verifyBiometric, verifyPin } from './app-lock.service.native';
import { shouldLockOnResume } from './lock-state';

export function AppLockGate({ children }: PropsWithChildren) {
  const [config, setConfig] = useState<LockConfig>();
  const [locked, setLocked] = useState(true);
  const backgroundAt = useRef<number | undefined>(undefined);
  const [shielded, setShielded] = useState(false);

  useEffect(() => {
    getLockConfig()
      .then((next) => {
        setConfig(next);
        setLocked(next.enabled);
      })
      .catch(() => {
        setConfig(undefined);
      });
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'inactive' || nextState === 'background') {
        backgroundAt.current = Date.now();
        setShielded(true);
        return;
      }
      if (nextState === 'active') {
        setShielded(false);
        if (
          config?.enabled &&
          shouldLockOnResume(backgroundAt.current, Date.now(), config.autoLockMs)
        )
          setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [config]);

  if (!config) return <SafeScreen title="Preparing privacy controls..." />;
  if (shielded) return <SafeScreen title="Personal Expense Tracker" />;
  if (!config.enabled || !locked) return children;
  return <LockScreen config={config} onUnlock={() => setLocked(false)} />;
}

function LockScreen({ config, onUnlock }: { config: LockConfig; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function unlockPin() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await verifyPin(pin);
      if (result.status === 'success') {
        setPin('');
        onUnlock();
      } else if (result.status === 'rate_limited')
        setMessage(`Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`);
      else setMessage('Incorrect PIN.');
    } finally {
      setBusy(false);
    }
  }
  async function unlockBiometric() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await verifyBiometric();
      if (result.status === 'success') onUnlock();
      else if (result.status === 'biometric_unavailable')
        setMessage('Biometrics are unavailable. Use your PIN.');
      else if (result.status === 'biometric_failed')
        setMessage('Biometric authentication failed. Use your PIN.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.content} accessibilityViewIsModal>
        <AppText variant="title" weight="700">
          Personal Expense Tracker
        </AppText>
        <AppText color={colors.textMuted}>Enter your PIN to unlock.</AppText>
        <TextInput
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={8}
          autoComplete="off"
          textContentType="oneTimeCode"
          accessibilityLabel="PIN digit field"
          style={styles.input}
          onSubmitEditing={unlockPin}
        />
        {message ? <AppText color={colors.danger}>{message}</AppText> : null}
        <AppButton
          label={busy ? 'Unlocking...' : 'Unlock'}
          disabled={busy || pin.length < 4}
          onPress={unlockPin}
        />
        {config.biometricEnabled ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={unlockBiometric}>
            <AppText weight="700" color={colors.primary}>
              Use Biometrics
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
function SafeScreen({ title }: { title: string }) {
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.content}>
        <AppText variant="title" weight="700">
          {title}
        </AppText>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center' },
  content: { gap: spacing.lg, alignItems: 'center' },
  input: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
  },
});
