import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon } from './Icon';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  accessibilityLabel: string;
};

/**
 * 44pt sunken field with a leading magnifier. It sits on `surfaceSunken` rather
 * than `surface` so it reads as a well cut into the page — the same treatment as
 * a progress track — which is what separates it from the cards below it.
 */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel }: Props) {
  const { palette, space, size, radius, type } = useTheme();
  return (
    <View
      style={[
        styles.field,
        {
          height: size.touchTarget,
          borderRadius: radius.control,
          paddingHorizontal: space.md + 2,
          gap: space.sm + 2,
          backgroundColor: palette.surfaceSunken,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairline,
        },
      ]}
    >
      <Icon name="search" size={18} color={palette.textTertiary} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        style={[styles.input, type.body, { color: palette.textPrimary }]}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          onPress={() => onChangeText('')}
        >
          <Icon name="x" size={18} color={palette.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    padding: 0,
    // Android centres single-line input text badly without this.
    ...Platform.select({ android: { textAlignVertical: 'center' as const } }),
  },
});
