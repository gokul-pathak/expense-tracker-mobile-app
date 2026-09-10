import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme';

export type DonutSegment = { key: string | number; value: number; color: string };

type Props = {
  segments: DonutSegment[];
  /** Outer diameter. */
  size?: number;
  strokeWidth?: number;
  /** Rendered in the centre: the total, typically. */
  children?: ReactNode;
  accessibilityLabel?: string;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const GAP = 2;

/**
 * Category share. Rounded caps, 2pt gaps, the total held in the centre.
 * Segments draw in from zero with a 40ms stagger; on web and under reduced
 * motion they simply appear.
 */
export function DonutChart({
  segments,
  size = 104,
  strokeWidth = 12,
  children,
  accessibilityLabel,
}: Props) {
  const { palette, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && Platform.OS !== 'web';

  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const radius = (size - strokeWidth) / 2;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const count = segments.length;
  const totalDuration =
    motion.chartDraw.duration + Math.max(count - 1, 0) * motion.chartDraw.stagger;

  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: totalDuration, easing: Easing.out(Easing.cubic) });
  }, [animate, progress, totalDuration, total]);

  // Round caps extend half the stroke past each end, so each dash is shortened
  // by a stroke width plus the gap and started half of that later.
  const arcs = segments.reduce<
    {
      key: string | number;
      color: string;
      visible: number;
      startAngle: number;
      windowStart: number;
      windowEnd: number;
      end: number;
    }[]
  >((acc, segment, index) => {
    const fraction = total === 0 ? 0 : Math.max(segment.value, 0) / total;
    const startFraction = acc.length === 0 ? 0 : (acc[acc.length - 1]?.end ?? 0);
    const length = fraction * circumference;
    acc.push({
      key: segment.key,
      color: segment.color,
      visible: Math.max(length - GAP - strokeWidth, 0.01),
      startAngle: -90 + startFraction * 360 + ((GAP + strokeWidth) / 2 / circumference) * 360,
      windowStart: (index * motion.chartDraw.stagger) / totalDuration,
      windowEnd: (index * motion.chartDraw.stagger + motion.chartDraw.duration) / totalDuration,
      end: startFraction + fraction,
    });
    return acc;
  }, []);

  return (
    <View
      style={{ width: size, height: size }}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={palette.surfaceSunken}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {arcs.map((arc) => (
          <Segment
            key={arc.key}
            centre={centre}
            radius={radius}
            circumference={circumference}
            strokeWidth={strokeWidth}
            color={arc.color}
            visible={arc.visible}
            startAngle={arc.startAngle}
            windowStart={arc.windowStart}
            windowEnd={arc.windowEnd}
            progress={progress}
          />
        ))}
      </Svg>
      {children ? <View style={styles.centre}>{children}</View> : null}
    </View>
  );
}

function Segment({
  centre,
  radius,
  circumference,
  strokeWidth,
  color,
  visible,
  startAngle,
  windowStart,
  windowEnd,
  progress,
}: {
  centre: number;
  radius: number;
  circumference: number;
  strokeWidth: number;
  color: string;
  visible: number;
  startAngle: number;
  windowStart: number;
  windowEnd: number;
  progress: { value: number };
}) {
  const animatedProps = useAnimatedProps(() => {
    const span = Math.max(windowEnd - windowStart, 0.0001);
    const local = Math.min(Math.max((progress.value - windowStart) / span, 0), 1);
    return { strokeDasharray: [Math.max(visible * local, 0.01), circumference] };
  });

  return (
    <AnimatedCircle
      cx={centre}
      cy={centre}
      r={radius}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      fill="none"
      rotation={startAngle}
      origin={centre + ', ' + centre}
      animatedProps={animatedProps}
    />
  );
}

const styles = StyleSheet.create({
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
