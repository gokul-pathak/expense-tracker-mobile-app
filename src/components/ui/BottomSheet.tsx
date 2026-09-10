import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Omit for a sheet whose body supplies its own heading, like Quick Add. */
  title?: string;
  /** The right-hand text action in the title row. Defaults to "Done". */
  doneLabel?: string;
  /** Let the body scroll. Off for short sheets, which should not bounce. */
  scroll?: boolean;
  children: ReactNode;
};

/**
 * Every picker and quick action in the app is one of these: dimmed blurred
 * backdrop, a sheet with `radius.sheet` top corners, a grab handle, and a
 * title row whose only action closes it.
 *
 * The backdrop is tappable because a sheet that can only be closed by a button
 * feels like a trap on a phone, and the handle promises a drag the platform
 * gesture would otherwise have to deliver.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  doneLabel = 'Done',
  scroll = false,
  children,
}: Props) {
  const { palette, space, size, radius, motion, gutter, backdrop, elevation } = useTheme();
  const insets = useSafeAreaInsets();

  const body = <View style={{ paddingBottom: insets.bottom + space.xxl }}>{children}</View>;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.host}>
        <Animated.View
          entering={FadeIn.duration(motion.tabChange.duration)}
          exiting={FadeOut}
          style={StyleSheet.absoluteFill}
        >
          {/* BlurView intensity is a 0-100 scale, not pixels; 3x lands near the token's 12px gaussian. */}
          <BlurView intensity={backdrop.blur * 3} tint="dark" style={StyleSheet.absoluteFill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: 'rgba(0,0,0,' + backdrop.opacity + ')' },
              ]}
            />
          </BlurView>
        </Animated.View>

        <Animated.View
          entering={SlideInDown.springify()
            .damping(motion.sheetPresent.damping * 20)
            .stiffness(motion.sheetPresent.stiffness)}
          exiting={SlideOutDown.duration(motion.tabChange.duration)}
          style={[
            styles.sheet,
            elevation.sheet,
            {
              maxHeight: '88%',
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              backgroundColor: palette.surface,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: palette.hairline,
              paddingTop: space.md + 2,
              paddingHorizontal: gutter,
            },
          ]}
        >
          <View
            style={[
              styles.handle,
              {
                width: size.sheetHandle.width,
                height: size.sheetHandle.height,
                borderRadius: radius.pill,
                backgroundColor: palette.textTertiary,
                marginBottom: title ? space.xl : space.lg,
              },
            ]}
          />
          {title ? (
            <View style={[styles.titleRow, { marginBottom: space.lg + 2 }]}>
              <Text variant="heading">{title}</Text>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={onClose}>
                <Text variant="subheading" tone="accent">
                  {doneLabel}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {scroll ? (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {body}
            </ScrollView>
          ) : (
            body
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  handle: { alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
