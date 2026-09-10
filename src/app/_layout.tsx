import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary, Text, ToastProvider } from '@/components/ui';
import { initializeDatabase } from '@/db/migrations';
import { CloudAuthProvider } from '@/features/cloud-auth/auth.provider';
import { AppLockGate } from '@/features/security/AppLockGate';
import { SyncProvider } from '@/features/sync/sync.provider';
import { ThemeProvider, useTheme } from '@/theme';

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
    </AppLockGate>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Deliberately empty while loading: the canvas colour and nothing else. A
 * spinner or a "Loading" line would make a sub-second wait feel longer.
 */
function BootScreen({ message }: { message?: string }) {
  const { palette, gutter } = useTheme();
  return (
    <View style={[styles.boot, { backgroundColor: palette.canvas, padding: gutter }]}>
      <ThemedStatusBar />
      {message ? (
        <Text variant="body" tone="secondary" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, justifyContent: 'center' },
});
