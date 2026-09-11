import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

type Props = {
  value: number;
  /** The figure `value` is measured against: a budget, or the largest category. */
  max: number;
  /** Fill colour. Defaults to the accent; category bars pass the category hue. */
  color?: string;
  accessibilityLabel?: string;
  /**
   * What the bar is worth, in words: "60% of budget spent".
   *
   * A bar's width says nothing out loud, so anything whose meaning is the
   * proportion states it. This is the platform's progress value rather than a
   * label, so it survives the bar sitting inside a row that is itself one
   * accessible element.
   */
  accessibilityValueText?: string;
};

/**
 * 6pt pill on a sunken track.
 *
 * Past `max` the bar does not stop at full: the track is rescaled so `max` sits
 * at a hairline marker and the overflow renders beyond it in `negative`. A
 * capped bar hides exactly the thing an over-budget user needs to see, which is
 * how far past they are rather than merely that they are past.
 */
export function ProgressBar({
  value,
  max,
  color,
  accessibilityLabel,
  accessibilityValueText,
}: Props) {
  const { palette, size, radius } = useTheme();
  const fill = color ?? palette.accent;
  const over = value > max && max > 0;
  const denominator = over ? value : Math.max(max, 1);
  const marker = over ? max / denominator : 1;
  const width = Math.min(Math.max(value / denominator, 0), 1);

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityValueText === undefined ? undefined : 'progressbar'}
      // `now` is uncapped, like the figure beside it: a bar that reports 100%
      // when the month is at 125% would say the opposite of what happened.
      accessibilityValue={
        accessibilityValueText === undefined
          ? undefined
          : { min: 0, max: Math.max(max, 1), now: value, text: accessibilityValueText }
      }
      style={[
        styles.track,
        {
          height: size.progressBar,
          borderRadius: radius.pill,
          backgroundColor: palette.surfaceSunken,
        },
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: percent(over ? marker : width),
            borderRadius: radius.pill,
            backgroundColor: fill,
          },
        ]}
      />
      {over ? (
        <>
          <View
            style={[
              styles.fill,
              {
                left: percent(marker),
                width: percent(1 - marker),
                borderRadius: radius.pill,
                backgroundColor: palette.negative,
              },
            ]}
          />
          <View
            style={[styles.marker, { left: percent(marker), backgroundColor: palette.canvas }]}
          />
        </>
      ) : null}
    </View>
  );
}

function percent(fraction: number): `${number}%` {
  return `${Math.round(fraction * 10000) / 100}%`;
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0 },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2 },
});
