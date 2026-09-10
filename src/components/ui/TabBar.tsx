import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { Tabs } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabIcon, useTheme, withAlpha } from '@/theme';

import { Icon, isIconName, type IconName } from './Icon';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0] & {
  /**
   * The centre button opens a sheet rather than navigating, so it is a callback
   * rather than a route. See `QuickAddProvider`.
   */
  onFabPress: () => void;
};

/**
 * A floating pill 20pt above the bottom safe area with a 16pt side inset:
 * blurred surface at 80% behind a hairline, four icons, and the FAB overlapping
 * its top edge. The active icon takes the accent with a 3pt dot beneath; the
 * canvas draws no labels, so none are drawn here either.
 */
export function TabBar({ state, descriptors, navigation, onFabPress }: TabBarProps) {
  const { palette, scheme, space, size, radius, elevation } = useTheme();
  const insets = useSafeAreaInsets();

  const press = (routeKey: string, routeName: string, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: routeKey, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      navigation.navigate(routeName);
    }
  };

  const tabs: ReactNode[] = state.routes.map((route, index) => {
    const focused = state.index === index;
    const title = descriptors[route.key]?.options.title;
    const iconKey = (tabIcon as Record<string, string>)[route.name];
    const icon: IconName = isIconName(iconKey) ? iconKey : 'circle-dashed';
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={typeof title === 'string' ? title : route.name}
        accessibilityState={{ selected: focused }}
        onPress={() => press(route.key, route.name, focused)}
        style={[styles.tab, { minWidth: size.touchTarget, minHeight: size.touchTarget }]}
      >
        <Icon name={icon} size={23} color={focused ? palette.accent : palette.textTertiary} />
        <View
          style={[
            styles.dot,
            { marginTop: space.xs + 1 },
            focused && { backgroundColor: palette.accent },
          ]}
        />
      </Pressable>
    );
  });

  // The FAB overlaps the bar's top edge, so the row leaves a hole for it rather
  // than the button covering a tab the user might be aiming at.
  const middle = Math.ceil(tabs.length / 2);
  tabs.splice(middle, 0, <View key="fab-gap" style={styles.fabGap} />);

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + space.xl }]}>
      <View
        style={[
          styles.bar,
          {
            height: size.tabBar,
            marginHorizontal: space.lg,
            borderRadius: radius.pill,
            borderColor: palette.hairline,
            paddingHorizontal: space.xxl + 2,
          },
          scheme === 'light' && elevation.card,
        ]}
      >
        <Surface />
        {tabs}
      </View>
      <FAB onPress={onFabPress} bottom={size.tabBar - 18} accessibilityLabel="Add transaction" />
    </View>
  );
}

/** Blur where it is cheap, a near-opaque surface where it is not. */
function Surface() {
  const { palette, scheme, radius } = useTheme();
  if (Platform.OS === 'android') {
    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius.pill, backgroundColor: withAlpha(palette.surface, 0.96) },
        ]}
      />
    );
  }
  return (
    <BlurView
      pointerEvents="none"
      intensity={80}
      tint={scheme === 'dark' ? 'dark' : 'light'}
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius.pill,
          overflow: 'hidden',
          backgroundColor: withAlpha(palette.surface, 0.8),
        },
      ]}
    />
  );
}

/**
 * 56pt circle in the primary fill with a soft accent glow in dark mode. It
 * opens Quick Add rather than pushing a screen.
 */
export function FAB({
  onPress,
  bottom,
  accessibilityLabel,
}: {
  onPress: () => void;
  bottom: number;
  accessibilityLabel: string;
}) {
  const { palette, scheme, size, motion, elevation } = useTheme();
  const glow =
    scheme === 'dark'
      ? {
          shadowColor: palette.accent,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 24,
          elevation: 8,
        }
      : {
          shadowColor: elevation.card.shadowColor,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.28,
          shadowRadius: 20,
          elevation: 8,
        };
  return (
    <View pointerEvents="box-none" style={[styles.fabHost, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={({ pressed }) => [
          styles.fab,
          glow,
          {
            width: size.fab,
            height: size.fab,
            borderRadius: size.fab / 2,
            backgroundColor: pressed ? palette.accentPressed : palette.primaryFill,
          },
          pressed && { transform: [{ scale: motion.press.scale }] },
        ]}
      >
        <Icon name="plus" size={26} color={palette.onPrimaryFill} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
  },
  tab: { alignItems: 'center', justifyContent: 'center' },
  dot: { width: 3, height: 3, borderRadius: 2 },
  fabGap: { width: 44 },
  fabHost: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  fab: { alignItems: 'center', justifyContent: 'center' },
});
