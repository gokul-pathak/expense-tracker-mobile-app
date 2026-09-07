import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'cloud-auth.supabase.session.v1';
const CHUNK_SIZE = 1_500;
const COUNT_KEY = `${KEY_PREFIX}.count`;

// SecureStore values have platform-specific size limits. Splitting preserves its protection
// without falling back to SQLite or an unencrypted store.
export const supabaseSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await SecureStore.getItemAsync(`${COUNT_KEY}.${key}`));
    if (!Number.isSafeInteger(count) || count < 1) return null;

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        SecureStore.getItemAsync(`${KEY_PREFIX}.${key}.${index}`),
      ),
    );
    return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    const previousCount = Number(await SecureStore.getItemAsync(`${COUNT_KEY}.${key}`)) || 0;
    const chunks = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [''];

    await Promise.all(
      chunks.map((chunk, index) =>
        SecureStore.setItemAsync(`${KEY_PREFIX}.${key}.${index}`, chunk),
      ),
    );
    await SecureStore.setItemAsync(`${COUNT_KEY}.${key}`, String(chunks.length));
    await Promise.all(
      Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, index) =>
        SecureStore.deleteItemAsync(`${KEY_PREFIX}.${key}.${chunks.length + index}`),
      ),
    );
  },
  async removeItem(key: string): Promise<void> {
    const count = Number(await SecureStore.getItemAsync(`${COUNT_KEY}.${key}`)) || 0;
    await Promise.all([
      SecureStore.deleteItemAsync(`${COUNT_KEY}.${key}`),
      ...Array.from({ length: count }, (_, index) =>
        SecureStore.deleteItemAsync(`${KEY_PREFIX}.${key}.${index}`),
      ),
    ]);
  },
};
