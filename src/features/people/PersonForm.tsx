import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { AppButton, FormField } from '@/components/ui';
import { spacing } from '@/constants/theme';
const schema = z.object({
  name: z.string().trim().min(1, 'Person name is required.'),
  note: z.string().optional(),
});
export type PersonFormValues = z.infer<typeof schema>;
export function PersonForm({
  initialValues,
  saving,
  onSave,
}: {
  initialValues?: PersonFormValues;
  saving: boolean;
  onSave: (values: PersonFormValues) => void;
}) {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PersonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? { name: '', note: '' },
  });
  return (
    <View style={styles.form}>
      <FormField
        control={control}
        name="name"
        label="Name"
        error={errors.name?.message}
        placeholder="e.g. Ram"
      />
      <FormField
        control={control}
        name="note"
        label="Note (optional)"
        error={errors.note?.message}
        placeholder="e.g. Friend"
        multiline
      />
      <AppButton
        label={saving ? 'Saving...' : 'Save Person'}
        disabled={saving}
        onPress={handleSubmit(onSave)}
      />
    </View>
  );
}
const styles = StyleSheet.create({ form: { gap: spacing.lg } });
