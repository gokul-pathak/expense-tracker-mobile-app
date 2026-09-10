import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { NavBar } from './NavBar';

type Props = {
  title: string;
  children: ReactNode;
  /** Defaults to going back. Pass a confirmation when there is unsaved work. */
  onBack?: () => void;
  /** `x` for an entry form you abandon, `arrow-left` for a screen you return from. */
  backIcon?: 'arrow-left' | 'x';
  /** The NavBar's right-hand text action, usually Save. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /**
   * Pinned above the safe area, outside the scroll — the primary action of an
   * entry form. It stays reachable however long the form gets.
   */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * The chrome every form and detail screen shares: a NavBar, a scrolling body on
 * the standard gutter, and an optional pinned footer.
 *
 * The footer lives outside the ScrollView so the save action never scrolls
 * away. The nav bar's hairline appears only once content has passed under it,
 * which keeps the top of an untouched form clean.
 */
export function FormScreen({
  title,
  children,
  onBack,
  backIcon = 'arrow-left',
  action,
  footer,
  contentStyle,
}: Props) {
  const { palette, space, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = useState(false);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: palette.canvas }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <NavBar
          title={title}
          onBack={onBack ?? (() => router.back())}
          backIcon={backIcon}
          backLabel={backIcon === 'x' ? 'Close' : 'Back'}
          action={action}
          divider={scrolled}
        />
        <ScrollView
          contentContainerStyle={[
            {
              paddingHorizontal: gutter,
              paddingTop: space.sm,
              paddingBottom: footer ? space.xxl : insets.bottom + space.xxxl,
            },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 4)}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: gutter,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.xl,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
