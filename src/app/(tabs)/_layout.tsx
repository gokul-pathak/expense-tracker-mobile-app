import { Tabs } from 'expo-router';

import { TabBar } from '@/components/ui';
import { QuickAddProvider, useQuickAdd } from '@/features/quick-add/QuickAdd';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  return (
    <QuickAddProvider>
      <TabsNavigator />
    </QuickAddProvider>
  );
}

/**
 * Split from the default export so the tab bar can reach the Quick Add sheet,
 * which is provided one level above the navigator.
 */
function TabsNavigator() {
  const { palette } = useTheme();
  const quickAdd = useQuickAdd();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} onFabPress={quickAdd.open} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
