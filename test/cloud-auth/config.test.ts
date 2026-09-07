import { describe, expect, it } from 'vitest';

import { readSupabaseConfig } from '@/lib/supabase/config';

describe('Supabase configuration', () => {
  it('keeps cloud optional when configuration is absent or malformed', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'not-a-url',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key',
      }),
    ).toBeNull();
  });

  it('accepts a complete public client configuration', () => {
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
      }),
    ).toEqual({ url: 'https://project.supabase.co', publishableKey: 'public-key' });
  });
});
