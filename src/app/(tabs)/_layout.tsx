import { Tabs } from 'expo-router';
import { Pressable, PressableProps, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/constants/theme';

function TabEmoji({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={[styles.emoji, focused && styles.emojiFocused]}>{emoji}</Text>;
}

type CenterAddButtonProps = {
  onPress?: PressableProps['onPress'];
  accessibilityState?: { selected?: boolean };
};

function CenterAddButton({ onPress, accessibilityState }: CenterAddButtonProps) {
  const selected = accessibilityState?.selected ?? false;

  return (
    <View style={styles.centerButtonWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.centerButton, pressed && styles.centerButtonPressed]}
      >
        <Text style={styles.plus}>+</Text>
      </Pressable>
      <Text style={styles.addLabel}>Add</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabEmoji emoji="⌂" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ focused }) => <TabEmoji emoji="≡" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarButton: (props) => <CenterAddButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ focused }) => <TabEmoji emoji="▥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused }) => <TabEmoji emoji="•••" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 72,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabLabel: {
    fontSize: typography.tab,
    fontWeight: '600',
  },
  emoji: {
    color: colors.textMuted,
    fontSize: 23,
    lineHeight: 26,
  },
  emojiFocused: {
    color: colors.primary,
  },
  centerButtonWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -20,
  },
  centerButton: {
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.surface,
  },
  centerButtonPressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ scale: 0.96 }],
  },
  plus: {
    color: colors.surface,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '300',
    marginTop: -2,
  },
  addLabel: {
    color: colors.textMuted,
    fontSize: typography.tab,
    fontWeight: '600',
    marginTop: 2,
  },
});
