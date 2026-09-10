import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = TextInputProps & {
  label: string;
  /** A validation message under the control, in `negative`. */
  error?: string;
  /** 88pt and top-aligned, for a note. */
  multiline?: boolean;
};

/**
 * Label above, control below, error beneath. The counterpart to
 * `SelectorField` for anything typed rather than chosen — it takes the same
 * surface, hairline and radius, so a form mixing the two reads as one stack.
 */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, multiline = false, style, ...props },
  ref,
) {
  const { palette, space, size, radius, gutter, type } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" tone="tertiary">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={palette.textTertiary}
        multiline={multiline}
        style={[
          type.body,
          {
            minHeight: multiline ? 88 : size.control,
            borderRadius: radius.control,
            paddingHorizontal: gutter - space.xs,
            paddingTop: multiline ? space.md : 0,
            paddingBottom: multiline ? space.md : 0,
            backgroundColor: palette.surface,
            color: palette.textPrimary,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? palette.negative : palette.hairline,
          },
          multiline && styles.multiline,
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text variant="caption" tone="negative" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  multiline: { textAlignVertical: 'top' },
});
