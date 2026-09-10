import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import {
  Button,
  CategoryChip,
  Chip,
  PickerSheet,
  SelectorField,
  Text,
  TextField,
  type PickerOption,
} from '@/components/ui';
import { CATEGORY_TYPES, type CategoryType } from '@/db/constants';
import { categoryIdentity, useTheme } from '@/theme';

const schema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  type: z.enum(CATEGORY_TYPES),
  icon: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof schema>;

type Props = {
  initialValues?: CategoryFormValues;
  saving: boolean;
  onSave: (values: CategoryFormValues) => void;
};

const labels: Record<CategoryType, string> = { expense: 'Expense', income: 'Income' };

export function CategoryForm({ initialValues, saving, onSave }: Props) {
  const { space } = useTheme();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? { name: '', type: 'expense', icon: '' },
  });
  const [type, setType] = useState<CategoryType>(initialValues?.type ?? 'expense');
  const [icon, setIcon] = useState(initialValues?.icon ?? '');
  const [showIcons, setShowIcons] = useState(false);

  // Every category needs an identity, so the choices are exactly the keys that
  // have one. A free-text icon could name something nothing renders, which is
  // how a category ends up grey and broken beside the others.
  const iconOptions: PickerOption<string>[] = Object.keys(categoryIdentity).map((key) => ({
    value: key,
    label: prettify(key),
    leading: <CategoryChip categoryIcon={key} size={28} />,
  }));

  return (
    <View style={{ gap: space.lg }}>
      <Controller
        control={control}
        name="name"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Name"
            placeholder="e.g. Coffee"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.name?.message}
          />
        )}
      />

      <View style={{ gap: space.sm }}>
        <Text variant="small" tone="tertiary">
          Type
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {CATEGORY_TYPES.map((value) => (
            <Chip
              key={value}
              label={labels[value]}
              icon={value === 'expense' ? 'arrow-up-right' : 'arrow-down-left'}
              selected={type === value}
              onPress={() => {
                setType(value);
                setValue('type', value, { shouldValidate: true });
              }}
            />
          ))}
        </View>
        {errors.type ? (
          <Text variant="caption" tone="negative" accessibilityRole="alert">
            {errors.type.message}
          </Text>
        ) : null}
      </View>

      <SelectorField
        label="Icon"
        value={icon ? prettify(icon) : undefined}
        placeholder="Optional"
        leading={icon ? <CategoryChip categoryIcon={icon} size={28} /> : null}
        onPress={() => setShowIcons(true)}
      />

      <View style={{ marginTop: space.sm }}>
        <Button label="Save Category" large loading={saving} onPress={handleSubmit(onSave)} />
      </View>

      <PickerSheet
        visible={showIcons}
        onClose={() => setShowIcons(false)}
        title="Choose an icon"
        options={iconOptions}
        selected={icon || undefined}
        clearOption={{
          label: 'None',
          onSelect: () => {
            setIcon('');
            setValue('icon', '');
          },
        }}
        onSelect={(next) => {
          setIcon(next);
          setValue('icon', next);
        }}
      />
    </View>
  );
}

function prettify(key: string) {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
