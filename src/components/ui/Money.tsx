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
 * A type style with its leading taken off. No part of an amount may carry a
 * line height, the small currency code included: on Android a `lineHeight` on
 * any span of a Text sets the height of the whole line that span sits on, and
 * React Native centres the font in it. The code's 16pt eyebrow leading was
 * squeezing the 44pt figure into a 16pt band across its middle, which is why
 * the code, the digits and the decimals were all sliced at the same height.
 * With no line height anywhere, the line takes the tallest font's own box and
 * every glyph fits. An amount is always one line, so there is no leading to
 * control anyway.
 */
function withoutLeading(style: TextStyle): TextStyle {
  return { ...style, lineHeight: undefined };
}

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
  const integerFont = withoutLeading(spec.integer);
  const codeFont = withoutLeading(type.eyebrow);
  /** A size that states a minimum scale shrinks to fit its box instead of ending in an ellipsis. */
  const minimumScale = 'minimumScale' in spec ? spec.minimumScale : undefined;

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
      adjustsFontSizeToFit={minimumScale !== undefined}
      minimumFontScale={minimumScale}
      style={[integerFont, { textAlign: align }, style]}
    >
      {showCode ? (
        <RNText
          style={[
            codeFont,
            { letterSpacing: 0.48, color: palette.textTertiary, textTransform: 'none' },
          ]}
        >
          {parts.code}
          {CODE_GAP}
        </RNText>
      ) : null}
      <RNText style={[integerFont, tabular, { color }]}>
        {sign}
        {parts.integer}
      </RNText>
      <RNText
        style={[
          integerFont,
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
