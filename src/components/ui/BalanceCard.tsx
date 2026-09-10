import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useCountUp } from '@/hooks/use-count-up';
import { useTheme } from '@/theme';
import { formatMinorUnits } from '@/utils/money';

import { Card } from './Card';
import { Icon } from './Icon';
import { Money } from './Money';
import { Text } from './Text';

type Props = {
  minorUnits: number;
  currency: string;
  label?: string;
  /** A factual line beneath the figure. Only shown when there is something true to say. */
  caption?: string;
  /** Change against a stated comparison, when one genuinely exists. */
  delta?: { percent: number; label: string };
};

const GLOW_HEIGHT = 60;

/**
 * The hero. The one `hero` figure on a screen, counted up on first paint. In
 * dark mode a barely-there champagne glow along the top edge lifts it off the
 * canvas, doing the work a shadow cannot do there.
 */
export function BalanceCard({
  minorUnits,
  currency,
  label = 'Total balance',
  caption,
  delta,
}: Props) {
  const { palette, scheme, space } = useTheme();
  const shown = useCountUp(minorUnits);

  return (
    <Card
      hero
      padding="xxl"
      accessible
      accessibilityLabel={label + ' ' + formatMinorUnits(minorUnits, currency)}
    >
      {scheme === 'dark' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height: GLOW_HEIGHT }]}>
          <Svg width="100%" height={GLOW_HEIGHT}>
            <Defs>
              <LinearGradient id="balanceGlow" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={palette.accent} stopOpacity={0.05} />
                <Stop offset="1" stopColor={palette.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height={GLOW_HEIGHT} fill="url(#balanceGlow)" />
          </Svg>
        </View>
      ) : null}

      <Text variant="eyebrow" tone="tertiary">
        {label}
      </Text>
      <View style={{ marginTop: space.sm }}>
        <Money minorUnits={shown} currency={currency} size="hero" />
      </View>

      {delta ? (
        <View style={[styles.delta, { marginTop: space.md, gap: space.xs + 2 }]}>
          <Icon
            name={delta.percent < 0 ? 'arrow-down-right' : 'arrow-up-right'}
            size="inline"
            color={delta.percent < 0 ? palette.negative : palette.positive}
          />
          <Text variant="smallStrong" tone={delta.percent < 0 ? 'negative' : 'positive'} tabular>
            {Math.abs(delta.percent).toFixed(1)}%
          </Text>
          <Text variant="small" tone="tertiary">
            {delta.label}
          </Text>
        </View>
      ) : caption ? (
        <Text variant="small" tone="tertiary" style={{ marginTop: space.md }}>
          {caption}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  delta: { flexDirection: 'row', alignItems: 'center' },
});
