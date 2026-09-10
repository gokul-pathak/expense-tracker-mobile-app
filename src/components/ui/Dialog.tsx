import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

type Props = {
  visible: boolean;
  title: string;
  /** One or two plain sentences saying exactly what will happen. */
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  /**
   * A filled `negative` confirm button. This is the only place in the app where
   * one is correct: the user has already been told what they are about to lose.
   */
  destructive?: boolean;
  /** The confirm action is in flight. */
  loading?: boolean;
};

/**
 * A centred confirmation for something irreversible. It is deliberately not a
 * sheet: a sheet is where you make a choice among many, a dialog is where you
 * stop and answer one question.
 */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
}: Props) {
  const { palette, space, size, radius, gutter, backdrop, elevation, motion } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={[styles.host, { padding: gutter + space.sm }]}>
        <Animated.View
          entering={FadeIn.duration(motion.tabChange.duration)}
          exiting={FadeOut}
          style={StyleSheet.absoluteFill}
        >
          <BlurView intensity={backdrop.blur * 3} tint="dark" style={StyleSheet.absoluteFill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              onPress={onCancel}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: 'rgba(0,0,0,' + backdrop.opacity + ')' },
              ]}
            />
          </BlurView>
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          entering={ZoomIn.springify()
            .damping(motion.sheetPresent.damping * 20)
            .stiffness(motion.sheetPresent.stiffness)}
          exiting={ZoomOut.duration(motion.tabChange.duration)}
          style={[
            styles.dialog,
            elevation.sheet,
            {
              borderRadius: radius.heroCard,
              backgroundColor: palette.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.hairline,
              padding: space.xxl,
              gap: space.sm,
            },
          ]}
        >
          <Text variant="heading" align="center" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="body" tone="secondary" align="center">
            {message}
          </Text>
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            {destructive ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                accessibilityState={{ disabled: loading, busy: loading }}
                disabled={loading}
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  }
                  onConfirm();
                }}
                style={({ pressed }) => [
                  styles.destructive,
                  {
                    minHeight: size.button,
                    borderRadius: radius.control,
                    backgroundColor: palette.negative,
                  },
                  pressed && { transform: [{ scale: motion.press.scale }] },
                  loading && styles.disabled,
                ]}
              >
                <Text variant="bodyStrong" color={palette.onAccent}>
                  {confirmLabel}
                </Text>
              </Pressable>
            ) : (
              <Button label={confirmLabel} onPress={onConfirm} loading={loading} />
            )}
            <Button label={cancelLabel} variant="text" fullWidth onPress={onCancel} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 340 },
  destructive: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
