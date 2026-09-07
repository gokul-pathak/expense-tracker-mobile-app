import * as Crypto from 'expo-crypto';

import { isSyncId } from '@/db/schema';

export { isSyncId };

/**
 * The single source of global sync identity for this app.
 * Feature modules must never generate their own identifiers.
 *
 * Works offline, needs no server, and uses the platform CSPRNG through
 * `expo-crypto`. A mutation must fail rather than persist a row without a
 * valid global identity.
 */
export function createSyncId(): string {
  const value = Crypto.randomUUID();
  if (!isSyncId(value)) {
    throw new Error('Sync identity generation failed: the platform returned an invalid UUID.');
  }
  return value;
}

/** Guards a stored identity before it is used as an outbox or cloud reference. */
export function requireSyncId(value: unknown, entity: string): string {
  if (!isSyncId(value)) {
    throw new Error(`Stored ${entity} is missing a valid sync identity.`);
  }
  return value;
}
