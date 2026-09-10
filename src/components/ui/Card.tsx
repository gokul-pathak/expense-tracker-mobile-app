import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme, type space } from '@/theme';

type Props = ViewProps & {
  children: ReactNode;
  /**
   * Inner padding, as a spacing token. Defaults to `lg` (16). Row lists inside
   * a card use `none` and let the rows carry their own padding.
   */
  padding?: keyof typeof space | 'none';
  /** The balance card and the budget hero use the larger radius. */
  hero?: boolean;
  /** Raised surface for something floating over the page — inputs, popovers. */
  raised?: boolean;
};

/**
 * `surface` ground, hairline border, theme-correct elevation. Reserve cards for
 * genuine grouping: a screen of six floating cards has no hierarchy, so prefer
 * one card of hairline-separated rows.
 */
export function Card({
  children,
  padding = 'lg',
  hero = false,
  raised = false,
  style,
  ...props
}: Props) {
  const { palette, radius, space, elevation } = useTheme();
  return (
    <View
      {...props}
      style={[
        styles.card,
        elevation.card,
        {
          backgroundColor: raised ? palette.surfaceRaised : palette.surface,
          borderColor: palette.hairline,
          borderRadius: hero ? radius.heroCard : radius.card,
          padding: padding === 'none' ? 0 : space[padding],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
