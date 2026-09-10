import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
};

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB = 20;
const INSET = 3;

/**
 * 44×26 with a 20pt knob. On takes the accent; off is a raised track with a
 * tertiary knob, so an off switch reads as inert rather than as an error.
 *
 * Rendered rather than wrapping RN's `Switch` because the platform control
 * cannot be tinted to this palette on both systems, and a settings list with
 * one iOS-green switch in it is the fastest way to break the design.
 */
export function Switch({ value, onValueChange, disabled = false, accessibilityLabel }: Props) {
  const { palette, radius, motion } = useTheme();
  const reduceMotion = useReducedMotion();

  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion
      ? value
        ? 1
        : 0
      : withTiming(value ? 1 : 0, { duration: motion.tabChange.duration });
  }, [value, reduceMotion, progress, motion.tabChange.duration]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (TRACK_WIDTH - KNOB - INSET * 2) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onValueChange(!value);
      }}
      style={[
        styles.track,
        {
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: radius.pill,
          padding: INSET,
          backgroundColor: value ? palette.accent : palette.surfaceRaised,
        },
        disabled && styles.disabled,
      ]}
    >
      <Animated.View
        style={[
          knobStyle,
          {
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            backgroundColor: value ? palette.onAccent : palette.textTertiary,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
