import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { AppButton, AppText, FormField } from '@/components/ui';
import { CATEGORY_TYPES } from '@/db/constants';
import { colors, radii, spacing } from '@/constants/theme';
const schema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  type: z.enum(CATEGORY_TYPES),
  icon: z.string().optional(),
});
export type CategoryFormValues = z.infer<typeof schema>;
export function CategoryForm({
  initialValues,
  saving,
  onSave,
}: {
  initialValues?: CategoryFormValues;
  saving: boolean;
  onSave: (values: CategoryFormValues) => void;
}) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? { name: '', type: 'expense', icon: '' },
  });
  const [type, setType] = useState(initialValues?.type ?? 'expense');
  return (
    <View style={styles.form}>
      <FormField
        control={control}
        name="name"
        label="Name"
        error={errors.name?.message}
        placeholder="e.g. Coffee"
      />
      <View style={styles.field}>
        <AppText weight="600">Type</AppText>
        <View style={styles.options}>
          {CATEGORY_TYPES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: type === value }}
              onPress={() => {
                setType(value);
                setValue('type', value, { shouldValidate: true });
              }}
              style={[styles.option, type === value && styles.optionSelected]}
            >
              <AppText weight="600" color={type === value ? colors.surface : colors.text}>
                {value === 'expense' ? 'Expense' : 'Income'}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>
      <FormField
        control={control}
        name="icon"
        label="Icon (optional)"
        error={errors.icon?.message}
        placeholder="e.g. coffee"
      />
      <AppButton
        label={saving ? 'Saving...' : 'Save Category'}
        disabled={saving}
        onPress={handleSubmit(onSave)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
});
