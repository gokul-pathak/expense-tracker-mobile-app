import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import { Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

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
  const { space } = useTheme();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PersonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? { name: '', note: '' },
  });

  return (
    <View style={{ gap: space.lg }}>
      <Controller
        control={control}
        name="name"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Name"
            placeholder="e.g. Ram"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="note"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Note"
            placeholder="How you know them"
            multiline
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.note?.message}
          />
        )}
      />
      <View style={{ marginTop: space.sm }}>
        <Button label="Save Person" large loading={saving} onPress={handleSubmit(onSave)} />
      </View>
    </View>
  );
}
