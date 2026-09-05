import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppButton, AppText, FormField } from '@/components/ui';
import { ACCOUNT_TYPES } from '@/db/constants';
import { colors, radii, spacing } from '@/constants/theme';
import { parseMoneyToMinorUnits } from '@/utils/money';

const schema = z.object({
  name: z.string().trim().min(1, 'Account name is required.'),
  type: z.enum(ACCOUNT_TYPES),
  openingBalance: z
    .string()
    .refine(
      (value) => parseMoneyToMinorUnits(value) !== null,
      'Enter a valid amount with up to two decimals.',
    ),
  currency: z.string().trim().min(1, 'Currency is required.'),
  icon: z.string().optional(),
});

export type AccountFormValues = z.infer<typeof schema>;
type Props = {
  initialValues?: AccountFormValues;
  saving: boolean;
  onSave: (values: AccountFormValues) => void;
};
const labels: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  cash: 'Cash',
  bank: 'Bank',
  wallet: 'Wallet',
  credit_card: 'Credit Card',
  other: 'Other',
};

export function AccountForm({ initialValues, saving, onSave }: Props) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? {
      name: '',
      type: 'cash',
      openingBalance: '0',
      currency: 'NPR',
      icon: '',
    },
  });
  const [type, setType] = useState(initialValues?.type ?? 'cash');
  return (
    <View style={styles.form}>
      <FormField
        control={control}
        name="name"
        label="Account Name"
        error={errors.name?.message}
        placeholder="e.g. Main Cash"
      />
      <View style={styles.field}>
        <AppText weight="600">Account Type</AppText>
        <View style={styles.options}>
          {ACCOUNT_TYPES.map((value) => (
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
              <AppText
                variant="caption"
                weight="600"
                color={type === value ? colors.surface : colors.text}
              >
                {labels[value]}
              </AppText>
            </Pressable>
          ))}
        </View>
        {errors.type ? (
          <AppText variant="caption" color={colors.danger}>
            {errors.type.message}
          </AppText>
        ) : null}
      </View>
      <FormField
        control={control}
        name="openingBalance"
        label="Opening Balance"
        error={errors.openingBalance?.message}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <FormField
        control={control}
        name="currency"
        label="Currency"
        error={errors.currency?.message}
        autoCapitalize="characters"
        placeholder="NPR"
        maxLength={8}
      />
      <FormField
        control={control}
        name="icon"
        label="Icon (optional)"
        error={errors.icon?.message}
        placeholder="e.g. wallet"
      />
      <AppButton
        label={saving ? 'Saving...' : 'Save Account'}
        disabled={saving}
        onPress={handleSubmit(onSave)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
});
