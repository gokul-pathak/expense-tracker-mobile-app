import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';
import { groupInteger, groupingStyleFor } from '@/utils/money';

import { Text } from './Text';
import type { MoneyDirection } from './Money';

type Props = {
  /** What has been typed, as a plain decimal string: `4250`, `4250.5`, `` for empty. */
  value: string;
  onChangeText: (value: string) => void;
  currency: string;
  /** Colours the figure. An expense form types in `negative`, income in `positive`. */
  direction?: MoneyDirection;
  label?: string;
  autoFocus?: boolean;
  /** A validation message under the hairline, in `negative`. */
  error?: string;
};

const CARET_BLINK_MS = 560;

/**
 * The figure at the top of every entry form: a 44pt amount that is typed into
 * rather than a field with a box around it.
 *
 * The real `TextInput` is invisible and stretched over the whole area, so the
 * keyboard, selection and paste all behave natively while the visible figure is
 * drawn to the design — grouped, split into integer and decimals, and coloured
 * by direction. Doing it the other way round, styling the input itself, cannot
 * produce the three-part treatment.
 */
export function AmountInput({
  value,
  onChangeText,
  currency,
  direction,
  label = 'Amount',
  autoFocus = true,
  error,
}: Props) {
  const { palette, space, size, type, moneySize } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const reduceMotion = useReducedMotion();

  const blink = useSharedValue(1);
  useEffect(() => {
    if (!focused || reduceMotion) {
      blink.value = focused ? 1 : 0;
      return;
    }
    blink.value = 1;
    blink.value = withRepeat(
      withTiming(0, { duration: CARET_BLINK_MS, easing: Easing.steps(2, true) }),
      -1,
      true,
    );
  }, [focused, reduceMotion, blink]);
  const caretStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const color =
    direction === 'expense'
      ? palette.negative
      : direction === 'income'
        ? palette.positive
        : palette.textPrimary;

  const [whole = '', fraction] = value.split('.');
  const integer = groupInteger(whole.replace(/^0+(?=\d)/, '') || '0', groupingStyleFor(currency));
  const decimals = (fraction ?? '').padEnd(2, '0').slice(0, 2);
  const entry = moneySize.entry;

  return (
    <View>
      <Pressable
        accessibilityRole="none"
        accessible={false}
        onPress={() => input.current?.focus()}
        style={{ paddingTop: space.sm, paddingBottom: space.xs }}
      >
        <Text variant="eyebrow" tone="tertiary" align="center">
          {label}
        </Text>
        <View style={[styles.figure, { marginTop: space.md, gap: entry.gap }]}>
          <Text variant="amount" tone="tertiary" tabular>
            {currency.toUpperCase()}
          </Text>
          <Text color={color} tabular style={entry.integer}>
            {integer}
          </Text>
          <Text
            color={color}
            tabular
            style={[entry.integer, { fontSize: entry.decimals, opacity: 0.6 }]}
          >
            .{decimals}
          </Text>
          <Animated.View
            style={[
              caretStyle,
              styles.caret,
              {
                width: size.caret.width,
                height: size.caret.height,
                borderRadius: size.caret.width,
                backgroundColor: palette.accent,
              },
            ]}
          />
        </View>

        <TextInput
          ref={input}
          accessibilityLabel={label + ' in ' + currency.toUpperCase()}
          value={value}
          onChangeText={(next) => onChangeText(sanitize(next))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          keyboardType="decimal-pad"
          inputMode="decimal"
          caretHidden
          selectionColor="transparent"
          style={[StyleSheet.absoluteFill, styles.hidden, type.body]}
        />
      </Pressable>

      <View style={[styles.rule, { backgroundColor: palette.hairline, marginTop: space.lg + 2 }]} />

      {error ? (
        <Text
          variant="caption"
          tone="negative"
          align="center"
          accessibilityRole="alert"
          style={{ marginTop: space.sm }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Digits and at most one dot with at most two places after it. Anything else is
 * dropped as it is typed rather than rejected on save, so the figure on screen
 * is always something the app can store.
 */
function sanitize(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole;
  return whole + '.' + rest.join('').slice(0, 2);
}

const styles = StyleSheet.create({
  figure: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  caret: { alignSelf: 'center' },
  hidden: { opacity: 0, color: 'transparent' },
  rule: { height: StyleSheet.hairlineWidth },
});
