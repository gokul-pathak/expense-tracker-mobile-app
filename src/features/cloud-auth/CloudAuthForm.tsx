import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';

import { Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

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
  const { space } = useTheme();
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
    <View style={{ gap: space.lg }}>
      <Controller
        control={control}
        name="email"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextField
            label="Password"
            secureTextEntry
            autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
          />
        )}
      />
      {mode === 'sign_up' ? (
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextField
              label="Confirm Password"
              secureTextEntry
              autoComplete="new-password"
              value={typeof value === 'string' ? value : ''}
              onChangeText={onChange}
              onBlur={onBlur}
              error={'confirmPassword' in errors ? errors.confirmPassword?.message : undefined}
            />
          )}
        />
      ) : null}
      <View style={{ marginTop: space.sm }}>
        <Button
          label={mode === 'sign_in' ? 'Sign In' : 'Create Account'}
          large
          loading={saving}
          onPress={handleSubmit(onSubmit)}
        />
      </View>
    </View>
  );
}
