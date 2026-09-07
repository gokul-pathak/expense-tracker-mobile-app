const KEY_PREFIX = 'cloud-auth.supabase.session.v1';

// Web has no Expo SecureStore equivalent. This isolated adapter uses browser storage only there.
export const supabaseSessionStorage = {
  getItem: async (key: string) => globalThis.localStorage?.getItem(`${KEY_PREFIX}.${key}`) ?? null,
  setItem: async (key: string, value: string) => {
    globalThis.localStorage?.setItem(`${KEY_PREFIX}.${key}`, value);
  },
  removeItem: async (key: string) => {
    globalThis.localStorage?.removeItem(`${KEY_PREFIX}.${key}`);
  },
};
