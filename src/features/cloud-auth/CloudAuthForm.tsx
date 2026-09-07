import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import { AppButton, FormField } from '@/components/ui';
import { spacing } from '@/constants/theme';

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
const signUpSchema = signInSchema
  .extend({
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = SignInValues & { confirmPassword: string };

type Props = {
  mode: 'sign_in' | 'sign_up';
  saving: boolean;
  onSubmit: (values: SignInValues | SignUpValues) => void;
};

export function CloudAuthForm({ mode, saving, onSubmit }: Props) {
  const schema = mode === 'sign_in' ? signInSchema : signUpSchema;
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInValues | SignUpValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      ...(mode === 'sign_up' ? { confirmPassword: '' } : {}),
    },
  });

  return (
    <View style={{ gap: spacing.lg }}>
      <FormField
        control={control}
        name="email"
        label="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        error={errors.email?.message}
      />
      <FormField
        control={control}
        name="password"
        label="Password"
        secureTextEntry
        autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
        error={errors.password?.message}
      />
      {mode === 'sign_up' ? (
        <FormField
          control={control}
          name="confirmPassword"
          label="Confirm Password"
          secureTextEntry
          autoComplete="new-password"
          error={'confirmPassword' in errors ? errors.confirmPassword?.message : undefined}
        />
      ) : null}
      <AppButton
        label={saving ? 'Please wait...' : mode === 'sign_in' ? 'Sign In' : 'Create Account'}
        disabled={saving}
        onPress={handleSubmit(onSubmit)}
      />
    </View>
  );
}
