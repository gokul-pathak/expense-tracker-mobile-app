import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Leave room beneath the content for the floating tab bar. On for the five
   * tab screens; off for anything pushed over them.
   */
  tabBar?: boolean;
  onScroll?: ScrollViewProps['onScroll'];
  refreshControl?: ScrollViewProps['refreshControl'];
};

/**
 * Safe-area wrapper with the 20pt gutter every screen shares. Consistent
 * gutters are most of what makes an app feel considered, so the value is not a
 * prop.
 */
export function Screen({
  children,
  scroll = false,
  contentStyle,
  tabBar = false,
  onScroll,
  refreshControl,
}: Props) {
  const { palette, gutter, space, size } = useTheme();
  const insets = useSafeAreaInsets();

  const bottom =
    insets.bottom + (tabBar ? size.tabBar + space.xl + space.xxxl : space.xxxl) + space.sm;
  const padding = {
    paddingHorizontal: gutter,
    paddingTop: space.md,
    paddingBottom: bottom,
  };

  if (scroll) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
        <ScrollView
          contentContainerStyle={[padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <View style={[styles.fill, padding, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
