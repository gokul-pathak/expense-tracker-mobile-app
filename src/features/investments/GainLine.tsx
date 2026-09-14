import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

import { presentGain, type GainKind } from './investment-presentation';

type Props = {
  minorUnits: number;
  currency: string;
  kind: GainKind;
  /** Include the currency code. Off where the surrounding card already names it. */
  code?: boolean;
  align?: 'left' | 'right';
  size?: 'caption' | 'body';
};

/**
 * A gain or a loss as a word and a signed figure: `Gain +1,140.00`.
 *
 * The word is what carries the meaning, so it survives a colour-blind reader and a
 * greyscale screenshot; the colour only agrees with it. Read aloud, it is
 * "Unrealized gain, 1,140 rupees", never a bare "+1,140".
 */
export function GainLine({
  minorUnits,
  currency,
  kind,
  code = false,
  align = 'left',
  size = 'caption',
}: Props) {
  const { space } = useTheme();
  const gain = presentGain(minorUnits, currency, kind, { code });
  return (
    <View
      accessible
      accessibilityLabel={gain.accessibilityLabel}
      style={[
        styles.line,
        { gap: space.xs, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' },
      ]}
    >
      <Text variant={size} tone="tertiary">
        {gain.label}
      </Text>
      {minorUnits === 0 ? null : (
        <Text
          variant={size === 'caption' ? 'captionStrong' : 'bodyStrong'}
          tone={gain.tone}
          tabular
        >
          {gain.value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps rather than overflowing when the text is scaled up.
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 },
});
