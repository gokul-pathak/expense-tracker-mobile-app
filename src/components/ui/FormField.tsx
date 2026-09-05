import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radii, spacing } from '@/constants/theme';

import { AppText } from './AppText';

type Props<T extends FieldValues> = TextInputProps & {
  control: Control<T>;
  name: Path<T>;
  label: string;
  error?: string;
};

export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  error,
  ...props
}: Props<T>) {
  return (
    <View style={styles.wrapper}>
      <AppText weight="600">{label}</AppText>
      <Controller
        control={control}
        name={name}
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            accessibilityLabel={label}
            onBlur={onBlur}
            onChangeText={onChange}
            value={value ?? ''}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, error && styles.inputError]}
            {...props}
          />
        )}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
});
