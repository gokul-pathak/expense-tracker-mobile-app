import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type MoneySize } from '@/theme';
import { formatMinorUnits } from '@/utils/money';

import { Money, type MoneyDirection } from './Money';
import { Text } from './Text';

type Props = {
  label: string;
  minorUnits: number;
  currency: string;
  direction?: MoneyDirection;
  size?: MoneySize;
  align?: 'left' | 'right' | 'center';
  style?: StyleProp<ViewStyle>;
};

/**
 * A compact labelled figure. These belong in one shared card beside each other,
 * never as separate cards: three floating cards would give three metrics the
 * same weight as the screen's hero and flatten the hierarchy.
 */
export function StatTile({
  label,
  minorUnits,
  currency,
  direction,
  size = 'stat',
  align = 'left',
  style,
}: Props) {
  const { space } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label + ' ' + formatMinorUnits(minorUnits, currency)}
      style={[{ gap: space.xs - 1 }, style]}
    >
      <Text variant="caption" tone="tertiary" align={align}>
        {label}
      </Text>
      <Money
        minorUnits={minorUnits}
        currency={currency}
        size={size}
        direction={direction}
        showCode={false}
        align={align}
      />
    </View>
  );
}
