import * as SecureStore from 'expo-secure-store';

import { DEFAULT_LOCK_CONFIG, type LockConfig, type LockCredential } from './app-lock.types';

const CONFIG_KEY = 'security.app-lock.config.v1';
const CREDENTIAL_KEY = 'security.app-lock.credential.v1';

export async function loadLockConfig(): Promise<LockConfig> {
  const stored = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!stored) return DEFAULT_LOCK_CONFIG;
  try {
    const value = JSON.parse(stored) as LockConfig;
    if (
      typeof value.enabled !== 'boolean' ||
      typeof value.biometricEnabled !== 'boolean' ||
      ![0, 60_000, 300_000, 900_000].includes(value.autoLockMs)
    )
      return DEFAULT_LOCK_CONFIG;
    return value;
  } catch {
    return DEFAULT_LOCK_CONFIG;
  }
}
export async function saveLockConfig(config: LockConfig) {
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config));
}
export async function loadCredential(): Promise<LockCredential | null> {
  const stored = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as LockCredential;
    return value.securityVersion === 1 &&
      typeof value.salt === 'string' &&
      typeof value.verifier === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}
export async function saveCredential(credential: LockCredential) {
  await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(credential));
}
export async function removeCredential() {
  await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
}
