import { DEFAULT_LOCK_CONFIG } from './app-lock.types';

const unavailable = async () => {
  throw new Error('App Lock is available in the Android/iOS app.');
};
export async function getLockConfig() {
  return DEFAULT_LOCK_CONFIG;
}
export const enableAppLock = unavailable;
export const verifyPin = unavailable;
export const changePin = unavailable;
export const disableAppLock = unavailable;
export const setAutoLockMs = unavailable;
export const enableBiometrics = unavailable;
export const disableBiometrics = unavailable;
export const verifyBiometric = unavailable;
