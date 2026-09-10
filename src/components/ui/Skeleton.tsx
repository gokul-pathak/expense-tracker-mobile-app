import { useEffect } from 'react';
import { type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

type Props = {
  width?: DimensionValue;
  height?: number;
  /** Defaults to the control radius; pass `pill` for text lines and avatars. */
  radius?: number | 'pill';
  style?: StyleProp<ViewStyle>;
};

const SHIMMER_MS = 1400;

/**
 * A shape standing in for the real one, shimmering at 1.4s. Never a spinner: a
 * skeleton tells the user what is arriving, a spinner only that they must wait.
 * Compose these into a layout that matches the loaded screen.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: Props) {
  const { palette, scheme, radius: radii } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(0.45, { duration: SHIMMER_MS / 2, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius === 'pill' ? radii.pill : (radius ?? radii.control),
          backgroundColor: scheme === 'dark' ? palette.surfaceRaised : palette.surfaceSunken,
        },
        animated,
        style,
      ]}
    />
  );
}
