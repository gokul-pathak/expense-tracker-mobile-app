import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import {
  Button,
  Chip,
  Icon,
  isIconName,
  PickerSheet,
  SelectorField,
  Text,
  TextField,
  type IconName,
  type PickerOption,
} from '@/components/ui';
import { ACCOUNT_TYPES, type AccountType } from '@/db/constants';
import { accountTypeIcon, useTheme } from '@/theme';
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

const labels: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank',
  wallet: 'Wallet',
  credit_card: 'Credit Card',
  other: 'Other',
};

/**
 * The icon is chosen from a fixed set rather than typed. The old field took any
 * string, which meant an account could carry an icon key nothing renders.
 */
const iconChoices: IconName[] = [
  'banknote',
  'landmark',
  'wallet',
  'credit-card',
  'coins',
  'briefcase',
  'smartphone',
  'hard-drive',
];

export function AccountForm({ initialValues, saving, onSave }: Props) {
  const { palette, space } = useTheme();
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
  const [type, setType] = useState<AccountType>(initialValues?.type ?? 'cash');
  const [icon, setIcon] = useState(initialValues?.icon ?? '');
  const [showIcons, setShowIcons] = useState(false);

  const iconOptions: PickerOption<string>[] = iconChoices.map((name) => ({
    value: name,
    label: iconLabel(name),
    icon: name,
  }));

  return (
    <View style={{ gap: space.lg }}>
      <Controller
        control={control}
        name="name"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Account Name"
            placeholder="e.g. Main Cash"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.name?.message}
          />
        )}
      />

      <View style={{ gap: space.sm }}>
        <Text variant="small" tone="tertiary">
          Account Type
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ACCOUNT_TYPES.map((value) => (
            <Chip
              key={value}
              label={labels[value]}
              icon={typeIcon(value)}
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

      <Controller
        control={control}
        name="openingBalance"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Opening Balance"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.openingBalance?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="currency"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Currency"
            placeholder="NPR"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.currency?.message}
          />
        )}
      />

      <SelectorField
        label="Icon"
        value={icon ? iconLabel(icon) : undefined}
        placeholder="Optional"
        leading={
          isIconName(icon) ? <Icon name={icon} size={18} color={palette.textSecondary} /> : null
        }
        onPress={() => setShowIcons(true)}
      />

      <View style={{ marginTop: space.sm }}>
        <Button label="Save Account" large loading={saving} onPress={handleSubmit(onSave)} />
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

function typeIcon(value: AccountType): IconName {
  const key = accountTypeIcon[value];
  return isIconName(key) ? key : 'wallet';
}

function iconLabel(name: string) {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
