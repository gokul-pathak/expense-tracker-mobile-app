import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary, Icon, Text, ToastProvider } from '@/components/ui';
import { initializeDatabase } from '@/db/migrations';
import { CloudAuthProvider } from '@/features/cloud-auth/auth.provider';
import { FirstRunGate } from '@/features/first-run/FirstRunGate';
import { AppLockGate } from '@/features/security/AppLockGate';
import { SyncProvider } from '@/features/sync/sync.provider';
import { ThemeProvider, useTheme, withAlpha } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <Boot />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The app blocks on two things before its first real frame: the database
 * migrations it already waited on, and now the fonts. A screen that renders
 * before Inter and Instrument Serif resolve flashes system-font text, which is
 * especially ugly on the 44pt hero balance. A font that fails to load is not
 * fatal; the system fallback is worse than the design but better than a wall.
 */
function Boot() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    InstrumentSerif_400Regular,
  });
  const [migrationError, setMigrationError] = useState<Error>();
  const [migrationsComplete, setMigrationsComplete] = useState(false);

  useEffect(() => {
    let isMounted = true;

    initializeDatabase()
      .then(() => {
        if (isMounted) setMigrationsComplete(true);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setMigrationError(
            error instanceof Error ? error : new Error('Unknown database migration error.'),
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (fontError && __DEV__) console.warn('Fonts failed to load.', fontError);
  }, [fontError]);

  if (migrationError) {
    return <BootScreen message={`Database initialization failed: ${migrationError.message}`} />;
  }

  if (!migrationsComplete || (!fontsLoaded && !fontError)) {
    return <BootScreen />;
  }

  return (
    <AppLockGate>
      <FirstRunGate>
        <CloudAuthProvider>
          {/*
          Sync lives inside the lock gate, so a locked device performs no
          synchronization and the first foreground sync happens after unlock.
        */}
          <SyncProvider>
            <AppErrorBoundary>
              <ThemedStatusBar />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
              </Stack>
            </AppErrorBoundary>
          </SyncProvider>
        </CloudAuthProvider>
      </FirstRunGate>
    </AppLockGate>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * The splash: the mark on the canvas, and nothing that moves.
 *
 * It waits on exactly what it already waited on — migrations and fonts — and
 * nothing else. Adding a session restore would put a network-shaped delay in
 * front of an app whose whole promise is working offline, and a minimum display
 * time would make it slower on purpose.
 *
 * No spinner. A sub-second wait feels longer with one, not shorter.
 */
function BootScreen({ message }: { message?: string }) {
  const { palette, gutter, space, radius } = useTheme();
  return (
    <View style={[styles.boot, { backgroundColor: palette.canvas, padding: gutter }]}>
      <ThemedStatusBar />
      <View
        style={[
          styles.mark,
          { borderRadius: radius.button, backgroundColor: withAlpha(palette.accent, 0.14) },
        ]}
      >
        <Icon name="shield-check" size={28} color={palette.accent} />
      </View>
      <Text variant="heading" style={{ marginTop: space.lg }}>
        Private Vault
      </Text>
      {message ? (
        <Text
          variant="body"
          tone="secondary"
          align="center"
          accessibilityRole="alert"
          style={{ marginTop: space.lg }}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
