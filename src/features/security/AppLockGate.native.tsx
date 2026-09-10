import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { useTheme, withAlpha } from '@/theme';

import { getLockConfig, verifyBiometric, verifyPin } from './app-lock.service.native';
import type { LockConfig } from './app-lock.types';
import { shouldLockOnResume } from './lock-state';

const MIN_PIN = 4;
const MAX_PIN = 8;

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

  if (!config) return <Shield />;
  if (shielded) return <Shield />;
  if (!config.enabled || !locked) return children;
  return <LockScreen config={config} onUnlock={() => setLocked(false)} />;
}

/**
 * What sits over the app in the recents switcher and before the lock config is
 * known. Deliberately just the mark on the canvas: the point of the shield is
 * that a shoulder-glance or a screenshot reveals no figures.
 */
function Shield() {
  const { palette, space } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, styles.centre, { backgroundColor: palette.canvas }]}>
      <Mark />
      <Text variant="heading" style={{ marginTop: space.lg }}>
        Private Vault
      </Text>
    </SafeAreaView>
  );
}

function Mark() {
  const { palette, radius } = useTheme();
  return (
    <View
      style={[
        styles.mark,
        { borderRadius: radius.button, backgroundColor: withAlpha(palette.accent, 0.14) },
      ]}
    >
      <Icon name="shield-check" size={28} color={palette.accent} />
    </View>
  );
}

function LockScreen({ config, onUnlock }: { config: LockConfig; onUnlock: () => void }) {
  const { palette, space, gutter } = useTheme();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]}>
      <View
        accessibilityViewIsModal
        style={[styles.fill, styles.centre, { paddingHorizontal: gutter }]}
      >
        <Mark />
        <Text variant="title" style={{ marginTop: space.lg }}>
          Enter your PIN
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: space.xs + 2 }}>
          Unlock Private Vault
        </Text>

        <View
          accessible
          accessibilityLabel={pin.length + ' of at least ' + MIN_PIN + ' digits entered'}
          style={[styles.dots, { marginTop: space.xxxl, gap: space.md }]}
        >
          {Array.from({ length: Math.max(MIN_PIN, pin.length) }, (_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index < pin.length
                  ? { backgroundColor: palette.accent }
                  : { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.textTertiary },
              ]}
            />
          ))}
        </View>

        <View style={{ minHeight: 20, marginTop: space.lg }}>
          {message ? (
            <Text variant="caption" tone="negative" align="center" accessibilityRole="alert">
              {message}
            </Text>
          ) : null}
        </View>

        <Keypad
          onDigit={(digit) => {
            if (busy || pin.length >= MAX_PIN) return;
            setMessage('');
            setPin(pin + digit);
          }}
          onDelete={() => {
            if (busy) return;
            setMessage('');
            setPin(pin.slice(0, -1));
          }}
        />

        <View style={{ marginTop: space.xl, alignSelf: 'stretch' }}>
          <Button
            label="Unlock"
            large
            loading={busy}
            disabled={busy || pin.length < MIN_PIN}
            onPress={() => void unlockPin()}
          />
        </View>

        {config.biometricEnabled ? (
          <View style={{ marginTop: space.md }}>
            <Button
              label="Use Face ID"
              variant="text"
              icon="fingerprint"
              disabled={busy}
              onPress={() => void unlockBiometric()}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );

  async function unlockPin() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await verifyPin(pin);
      if (result.status === 'success') {
        setPin('');
        onUnlock();
        return;
      }
      setPin('');
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      if (result.status === 'rate_limited') {
        setMessage(`Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`);
      } else {
        setMessage('Incorrect PIN.');
      }
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
}

/**
 * A drawn keypad rather than the system keyboard. A PIN screen that raises a
 * numeric keyboard puts the digits in a different place on every device and
 * covers half the screen doing it; here the targets are always where they were
 * last time.
 */
function Keypad({ onDigit, onDelete }: { onDigit: (digit: string) => void; onDelete: () => void }) {
  const { space } = useTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <View style={[styles.keypad, { marginTop: space.xxl, gap: space.md }]}>
      {keys.map((key) => (
        <Key key={key} label={key} onPress={() => onDigit(key)} />
      ))}
      <View style={styles.key} />
      <Key label="0" onPress={() => onDigit('0')} />
      <Key label="Delete" icon onPress={onDelete} />
    </View>
  );
}

function Key({
  label,
  icon = false,
  onPress,
}: {
  label: string;
  icon?: boolean;
  onPress: () => void;
}) {
  const { palette, radius, motion } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.key,
        styles.centre,
        { borderRadius: radius.pill },
        pressed && {
          backgroundColor: palette.surfaceRaised,
          transform: [{ scale: motion.press.scale }],
        },
      ]}
    >
      {icon ? (
        <Icon name="delete" size={24} color={palette.textSecondary} />
      ) : (
        <Text variant="title" tabular>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  mark: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row' },
  dot: { width: 16, height: 16, borderRadius: 8 },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 300,
  },
  key: { width: 84, height: 64 },
});
