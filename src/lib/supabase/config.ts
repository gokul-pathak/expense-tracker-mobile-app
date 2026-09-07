export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function readSupabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): SupabaseConfig | null {
  const url = environment.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }

  return { url, publishableKey };
}

export const supabaseConfig = readSupabaseConfig();
