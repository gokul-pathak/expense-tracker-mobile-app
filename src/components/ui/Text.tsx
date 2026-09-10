import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { useTheme, type TypeVariant } from '@/theme';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'positive'
  | 'negative'
  | 'info'
  | 'warning'
  | 'onAccent'
  | 'onPrimaryFill';

export type UiTextProps = TextProps & {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Tabular lining figures. Set on anything numeric that sits in a column. */
  tabular?: boolean;
  align?: TextStyle['textAlign'];
  /**
   * Escape hatch for a colour that is not a text tone — a category hue, or a
   * palette value chosen by the parent. Never a literal.
   */
  color?: string;
};

/**
 * Every piece of text takes a `variant` from the type scale rather than loose
 * size and weight props. That is what keeps `fontSize: 15` from appearing
 * inline across the codebase, and it means size, leading, family and tracking
 * always travel together.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  tabular = false,
  align,
  color,
  style,
  ...props
}: UiTextProps) {
  const { palette, type } = useTheme();
  const toneColor: Record<TextTone, string> = {
    primary: palette.textPrimary,
    secondary: palette.textSecondary,
    tertiary: palette.textTertiary,
    accent: palette.accent,
    positive: palette.positive,
    negative: palette.negative,
    info: palette.info,
    warning: palette.warning,
    onAccent: palette.onAccent,
    onPrimaryFill: palette.onPrimaryFill,
  };

  return (
    <RNText
      {...props}
      style={[
        type[variant],
        { color: color ?? toneColor[tone] },
        variant === 'eyebrow' && { textTransform: 'uppercase' },
        tabular && { fontVariant: ['tabular-nums'] },
        align !== undefined && { textAlign: align },
        style,
      ]}
    />
  );
}
