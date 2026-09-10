import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { useTheme, type MoneySize } from '@/theme';
import { splitMinorUnits } from '@/utils/money';

export type MoneyDirection = 'expense' | 'income' | 'neutral';

type Props = {
  /** Always integer minor units, never a float. */
  minorUnits: number;
  currency: string;
  size?: MoneySize;
  /**
   * Sets sign and colour. `expense` renders a true minus in `negative`,
   * `income` a plus in `positive`, `neutral` no sign and the primary colour.
   * Omit for a plain total, which takes `negative` only when it is below zero.
   */
  direction?: MoneyDirection;
  /** Defaults to true, except at `row` size where the list already states the currency. */
  showCode?: boolean;
  /**
   * Render every part in the tertiary tone while keeping the sign. For a
   * subordinate figure that is still an amount — a day total above a list, a
   * legend value — where direction colour would outshout the rows beneath it.
   */
  muted?: boolean;
  align?: 'left' | 'right' | 'center';
  style?: StyleProp<TextStyle>;
};

/** True minus, U+2212. A hyphen is too short and sits at the wrong height. */
const MINUS = '−';
/** Thin space plus a space: the 6pt gap between code and integer at 12pt. */
const CODE_GAP = '  ';

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * The most-used component in the app. An amount is three parts at three
 * treatments (code, integer, decimals), never one flat string. Digits are
 * tabular so columns of amounts align, and colour carries direction.
 */
export function Money({
  minorUnits,
  currency,
  size = 'row',
  direction,
  showCode = size !== 'row',
  muted = false,
  align = 'left',
  style,
}: Props) {
  const { palette, moneySize, type } = useTheme();
  const parts = splitMinorUnits(minorUnits, currency);
  const spec = moneySize[size];

  let sign = '';
  let color = palette.textPrimary;
  if (direction === 'expense') {
    sign = MINUS;
    color = palette.negative;
  } else if (direction === 'income') {
    sign = '+';
    color = palette.positive;
  } else if (direction === undefined && parts.negative) {
    sign = MINUS;
    color = palette.negative;
  }

  if (muted) color = palette.textTertiary;
  const coloured = !muted && color !== palette.textPrimary;
  const spokenSign = sign === MINUS ? 'minus ' : sign === '+' ? 'plus ' : '';
  const spoken = spokenSign + parts.code + ' ' + parts.integer + '.' + parts.decimals;

  return (
    <RNText
      accessible
      accessibilityLabel={spoken}
      numberOfLines={1}
      style={[{ lineHeight: spec.integer.lineHeight, textAlign: align }, style]}
    >
      {showCode ? (
        <RNText
          style={[
            type.eyebrow,
            { letterSpacing: 0.48, color: palette.textTertiary, textTransform: 'none' },
          ]}
        >
          {parts.code}
          {CODE_GAP}
        </RNText>
      ) : null}
      <RNText style={[spec.integer, tabular, { color }]}>
        {sign}
        {parts.integer}
      </RNText>
      <RNText
        style={[
          spec.integer,
          tabular,
          {
            fontSize: spec.decimals,
            color: coloured ? color : palette.textTertiary,
            opacity: coloured ? 0.65 : 1,
          },
        ]}
      >
        .{parts.decimals}
      </RNText>
    </RNText>
  );
}
