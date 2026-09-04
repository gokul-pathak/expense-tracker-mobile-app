import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeDatabase } from '@/db/migrations';

export default function RootLayout() {
  const [migrationError, setMigrationError] = useState<Error>();
  const [migrationsComplete, setMigrationsComplete] = useState(false);

  useEffect(() => {
    let isMounted = true;

    initializeDatabase()
      .then(() => {
        if (isMounted) {
          setMigrationsComplete(true);
        }
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

  if (migrationError) {
    return (
      <SafeAreaProvider>
        <View>
          <Text>Database initialization failed: {migrationError.message}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!migrationsComplete) {
    return (
      <SafeAreaProvider>
        <View>
          <Text>Initializing database...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}
