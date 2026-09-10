import { useEffect, useMemo, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type AreaSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

type Props = {
  /** One label per point. Only the first and last few are drawn under the axis. */
  labels: string[];
  /** One or two series. Every series must have one value per label. */
  series: AreaSeries[];
  /** Turns a raw value into the string shown in the scrubber tooltip. */
  formatValue: (value: number) => string;
  height?: number;
  accessibilityLabel: string;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);
const PAD_TOP = 10;
const PAD_BOTTOM = 8;

/**
 * Income against expense over time: two smoothed lines with a gradient fading
 * to nothing, and a scrubber that reports the exact figures for one point.
 *
 * The lines are smoothed rather than straight because the underlying data is a
 * bucketed total, and sharp vertices would imply a precision between buckets
 * that does not exist.
 */
export function AreaChart({
  labels,
  series,
  formatValue,
  height = 130,
  accessibilityLabel,
}: Props) {
  const { palette, space, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && Platform.OS !== 'web';

  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number>();

  const count = labels.length;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const maximum = Math.max(1, ...series.flatMap((item) => item.values));

  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: motion.chartDraw.duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [animate, progress, motion.chartDraw.duration, maximum, count]);

  const step = count > 1 ? width / (count - 1) : 0;
  const pointsFor = useMemo(
    () => (values: number[]) =>
      values.map((value, index) => ({
        x: count > 1 ? index * step : width / 2,
        y: PAD_TOP + plotHeight - (value / maximum) * plotHeight,
      })),
    [count, step, width, plotHeight, maximum],
  );

  // Touch anywhere on the plot picks the nearest point rather than requiring a
  // hit on the line itself, which is a 2pt target and unusable with a finger.
  const responder = useMemo(() => {
    const pick = (x: number) => {
      if (step <= 0) return;
      setActive(Math.min(Math.max(Math.round(x / step), 0), count - 1));
    };
    const release = () => setActive(undefined);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => count > 1,
      onMoveShouldSetPanResponder: () => count > 1,
      onPanResponderGrant: (event) => pick(event.nativeEvent.locationX),
      onPanResponderMove: (event) => pick(event.nativeEvent.locationX),
      onPanResponderRelease: release,
      onPanResponderTerminate: release,
    });
  }, [count, step]);

  const activePoints =
    active === undefined
      ? []
      : series.map((item) => ({
          series: item,
          value: item.values[active] ?? 0,
          point: pointsFor(item.values)[active],
        }));
  const activeX = activePoints[0]?.point?.x ?? 0;

  return (
    <View
      accessible={active === undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    >
      <View style={{ height }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <View {...responder.panHandlers} style={StyleSheet.absoluteFill}>
            <Svg width={width} height={height}>
              <Defs>
                {series.map((item) => (
                  <LinearGradient
                    key={item.key}
                    id={'area-' + item.key}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <Stop offset="0" stopColor={item.color} stopOpacity="0.26" />
                    <Stop offset="1" stopColor={item.color} stopOpacity="0" />
                  </LinearGradient>
                ))}
              </Defs>
              {series.map((item) => {
                const points = pointsFor(item.values);
                const line = smoothPath(points);
                return (
                  <Series
                    key={item.key}
                    id={item.key}
                    color={item.color}
                    line={line}
                    fill={
                      line +
                      ' L' +
                      (points[points.length - 1]?.x ?? 0) +
                      ',' +
                      height +
                      ' L' +
                      (points[0]?.x ?? 0) +
                      ',' +
                      height +
                      ' Z'
                    }
                    length={pathLength(points)}
                    progress={progress}
                  />
                );
              })}
              {active !== undefined ? (
                <>
                  <Line
                    x1={activeX}
                    y1={PAD_TOP - 4}
                    x2={activeX}
                    y2={height - PAD_BOTTOM + 4}
                    stroke={palette.textTertiary}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {activePoints.map((entry) =>
                    entry.point ? (
                      <Circle
                        key={entry.series.key}
                        cx={entry.point.x}
                        cy={entry.point.y}
                        r={4}
                        fill={entry.series.color}
                        stroke={palette.surface}
                        strokeWidth={1.5}
                      />
                    ) : null,
                  )}
                </>
              ) : null}
            </Svg>
          </View>
        ) : null}
      </View>

      {active === undefined ? (
        <View style={[styles.axis, { marginTop: space.sm }]}>
          {labels.map((label, index) => (
            <Text key={label + index} variant="tab" tone="tertiary">
              {label}
            </Text>
          ))}
        </View>
      ) : (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.readout, { marginTop: space.sm, gap: space.md }]}
        >
          <Text variant="tab" tone="tertiary">
            {labels[active]}
          </Text>
          {activePoints.map((entry) => (
            <Text key={entry.series.key} variant="captionStrong" color={entry.series.color} tabular>
              {formatValue(entry.value)}
            </Text>
          ))}
        </View>
      )}

      <View style={[styles.legend, { marginTop: space.sm + 2, gap: space.lg }]}>
        {series.map((item) => (
          <View key={item.key} style={[styles.legendItem, { gap: space.xs + 2 }]}>
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
            <Text variant="caption" tone="secondary">
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Series({
  id,
  color,
  line,
  fill,
  length,
  progress,
}: {
  id: string;
  color: string;
  line: string;
  fill: string;
  length: number;
  progress: { value: number };
}) {
  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - progress.value),
  }));
  const fillProps = useAnimatedProps(() => ({ opacity: progress.value }));

  return (
    <>
      <AnimatedPath d={fill} fill={'url(#area-' + id + ')'} animatedProps={fillProps} />
      <AnimatedPath
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={length}
        animatedProps={lineProps}
      />
    </>
  );
}

type Point = { x: number; y: number };

/**
 * Catmull-Rom through every point, converted to cubic beziers. The curve passes
 * through the data rather than near it, which matters when a reader is scrubbing
 * for one week's actual figure.
 */
function smoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return 'M' + first.x + ',' + first.y;

  let path = 'M' + first.x + ',' + first.y;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? points[index + 1];
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2.x + ',' + p2.y;
  }
  return path;
}

/**
 * Polyline length with a margin. SVG path length cannot be measured in React
 * Native, and the dash only has to be at least as long as the curve for the
 * draw-in to finish cleanly, so overestimating is safe.
 */
function pathLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return Math.max(total * 1.15, 1);
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  readout: { flexDirection: 'row', alignItems: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 10, height: 3, borderRadius: 2 },
});
