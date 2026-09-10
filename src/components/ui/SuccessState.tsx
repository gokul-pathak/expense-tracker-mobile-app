import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, withAlpha } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { Money, type MoneyDirection } from './Money';
import { Text } from './Text';

type Props = {
  title: string;
  amount?: { minorUnits: number; currency: string; direction?: MoneyDirection };
  /** One factual line: "Groceries · NIC Asia Bank · Today". */
  caption?: string;
  onDone: () => void;
  doneLabel?: string;
  secondaryAction?: { label: string; onPress: () => void };
};

const GLOW = 280;

/**
 * Full-screen confirmation after a save. A check in a positive tint over a
 * soft radial glow, the figure at feature size, and two actions at the foot.
 * The amount counts up on first paint through `<Money>`'s own reveal.
 */
export function SuccessState({
  title,
  amount,
  caption,
  onDone,
  doneLabel = 'Done',
  secondaryAction,
}: Props) {
  const { palette, space, gutter } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.fill, { backgroundColor: palette.canvas }]}>
      <View style={[styles.centre, { paddingHorizontal: gutter + space.md }]}>
        <View pointerEvents="none" style={styles.glow}>
          <Svg width={GLOW} height={GLOW}>
            <Defs>
              <RadialGradient id="successGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={palette.positive} stopOpacity={0.14} />
                <Stop offset="0.7" stopColor={palette.positive} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#successGlow)" />
          </Svg>
        </View>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: withAlpha(palette.positive, 0.14),
              borderColor: withAlpha(palette.positive, 0.3),
            },
          ]}
        >
          <Icon name="check" size={44} color={palette.positive} />
        </View>
        <Text variant="title" align="center" style={{ marginTop: space.xxl }}>
          {title}
        </Text>
        {amount ? (
          <View style={{ marginTop: space.md }}>
            <Money
              minorUnits={amount.minorUnits}
              currency={amount.currency}
              size="feature"
              direction={amount.direction}
              align="center"
            />
          </View>
        ) : null}
        {caption ? (
          <Text variant="body" tone="secondary" align="center" style={{ marginTop: space.sm }}>
            {caption}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          paddingHorizontal: gutter,
          paddingBottom: insets.bottom + space.xl,
          gap: space.md,
        }}
      >
        <Button label={doneLabel} onPress={onDone} />
        {secondaryAction ? (
          <Button
            label={secondaryAction.label}
            variant="text"
            onPress={secondaryAction.onPress}
            fullWidth
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
