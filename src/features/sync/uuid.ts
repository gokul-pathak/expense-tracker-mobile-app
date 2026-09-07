import * as Crypto from 'expo-crypto';

// Future explicit local/remote mutation APIs use this offline UUID v4 source.
export function createSyncId() {
  return Crypto.randomUUID();
}
