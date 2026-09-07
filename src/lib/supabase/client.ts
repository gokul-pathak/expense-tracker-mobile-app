import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseConfig } from './config';
import { supabaseSessionStorage } from './storage';

let client: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseConfig) return null;
  client ??= createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      storage: supabaseSessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
