import { Text, TextProps, TextStyle } from 'react-native';

import { colors, typography } from '@/constants/theme';

type TextVariant = 'title' | 'heading' | 'subheading' | 'body' | 'caption';

type Props = TextProps & {
  variant?: TextVariant;
  color?: string;
  weight?: TextStyle['fontWeight'];
};

const sizes: Record<TextVariant, number> = {
  title: typography.title,
  heading: typography.heading,
  subheading: typography.subheading,
  body: typography.body,
  caption: typography.caption,
};

export function AppText({
  variant = 'body',
  color = colors.text,
  weight = '400',
  style,
  ...props
}: Props) {
  return (
    <Text
      {...props}
      style={[
        {
          color,
          fontSize: sizes[variant],
          fontWeight: weight,
          lineHeight: sizes[variant] * 1.35,
        },
        style,
      ]}
    />
  );
}
