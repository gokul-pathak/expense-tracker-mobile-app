import * as Crypto from 'expo-crypto';

import type { AuthenticationResult, AutoLockTimeout } from './app-lock.types';
import { DEFAULT_LOCK_CONFIG } from './app-lock.types';
import { authenticateBiometric, canUseBiometrics } from './biometric.service.native';
import { isValidPin, retryAfterMs } from './lock-state';
import {
  loadCredential,
  loadLockConfig,
  removeCredential,
  saveCredential,
  saveLockConfig,
} from './app-lock.storage.native';

let failedAttempts = 0;
let retryAt = 0;
let authenticationInProgress = false;

export async function getLockConfig() {
  return loadLockConfig();
}
export async function enableAppLock(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN must contain 4 to 8 digits.');
  const credential = await createCredential(pin);
  // Credential is committed first; the enabled marker is written last to avoid a locked, credentialless state.
  await saveCredential(credential);
  await saveLockConfig({ ...DEFAULT_LOCK_CONFIG, enabled: true });
}
export async function verifyPin(pin: string): Promise<AuthenticationResult> {
  const now = Date.now();
  if (now < retryAt) return { status: 'rate_limited', retryAfterMs: retryAt - now };
  const credential = await loadCredential();
  if (!credential || !isValidPin(pin)) return registerFailure();
  const verifier = await deriveVerifier(pin, credential.salt);
  if (verifier !== credential.verifier) return registerFailure();
  failedAttempts = 0;
  retryAt = 0;
  return { status: 'success' };
}
export async function changePin(
  currentPin: string,
  nextPin: string,
): Promise<AuthenticationResult> {
  const verified = await verifyPin(currentPin);
  if (verified.status !== 'success') return verified;
  if (!isValidPin(nextPin)) throw new Error('PIN must contain 4 to 8 digits.');
  // One SecureStore item contains both salt and verifier, so a failed replacement preserves the old credential.
  await saveCredential(await createCredential(nextPin));
  return { status: 'success' };
}
export async function disableAppLock(pin: string): Promise<AuthenticationResult> {
  const verified = await verifyPin(pin);
  if (verified.status !== 'success') return verified;
  await saveLockConfig(DEFAULT_LOCK_CONFIG);
  await removeCredential();
  return { status: 'success' };
}
export async function setAutoLockMs(autoLockMs: AutoLockTimeout) {
  const config = await loadLockConfig();
  if (!config.enabled) throw new Error('Enable App Lock before configuring Auto-Lock.');
  await saveLockConfig({ ...config, autoLockMs });
}
export async function enableBiometrics(): Promise<AuthenticationResult> {
  const config = await loadLockConfig();
  if (!config.enabled || !(await canUseBiometrics())) return { status: 'biometric_unavailable' };
  const result = await authenticateBiometric();
  if (result === 'success') {
    await saveLockConfig({ ...config, biometricEnabled: true });
    return { status: 'success' };
  }
  return { status: result === 'cancelled' ? 'cancelled' : 'biometric_failed' };
}
export async function disableBiometrics() {
  const config = await loadLockConfig();
  await saveLockConfig({ ...config, biometricEnabled: false });
}
export async function verifyBiometric(): Promise<AuthenticationResult> {
  if (authenticationInProgress) return { status: 'cancelled' };
  authenticationInProgress = true;
  try {
    const config = await loadLockConfig();
    if (!config.enabled || !config.biometricEnabled || !(await canUseBiometrics()))
      return { status: 'biometric_unavailable' };
    const result = await authenticateBiometric();
    return result === 'success'
      ? { status: 'success' }
      : { status: result === 'cancelled' ? 'cancelled' : 'biometric_failed' };
  } finally {
    authenticationInProgress = false;
  }
}

async function createCredential(pin: string) {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const salt = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { securityVersion: 1 as const, salt, verifier: await deriveVerifier(pin, salt) };
}
async function deriveVerifier(pin: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}
function registerFailure(): AuthenticationResult {
  failedAttempts += 1;
  const delay = retryAfterMs(failedAttempts);
  retryAt = Date.now() + delay;
  return delay ? { status: 'rate_limited', retryAfterMs: delay } : { status: 'invalid_pin' };
}
