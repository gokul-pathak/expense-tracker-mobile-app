import * as Crypto from 'expo-crypto';
import { v5 as uuidv5 } from 'uuid';

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
  // A random identity is always version 4. Checking the version, not merely the
  // shape, keeps the one place that issues random IDs from ever handing out
  // something that could be mistaken for a name-based one.
  if (!isSyncId(value) || value[14] !== '4') {
    throw new Error('Sync identity generation failed: the platform returned an invalid UUID.');
  }
  return value;
}

/**
 * A name-based identity: RFC 4122 version 5, SHA-1 over a namespace and a name.
 *
 * The same namespace and name produce the same UUID on every device, forever,
 * without any device asking another. That is the whole point, and it is used for
 * exactly one thing: two offline devices generating the same recurring
 * occurrence must agree on its identity — and on the identity of the
 * transaction it produces — or the cloud would receive two records of one rent
 * payment, and nothing afterwards could tell which was the real one.
 *
 * The algorithm is the `uuid` package's, never a hand-rolled hash. Metro
 * resolves it to the package's pure-JavaScript SHA-1 build and Node to its
 * crypto-backed one; both implement the same RFC, and a test asserts they agree
 * with each other and with the RFC's published vectors.
 */
export function createNameBasedSyncId(namespace: string, name: string): string {
  const value = uuidv5(name, namespace);
  if (!isSyncId(value) || value[14] !== '5') {
    throw new Error('Sync identity derivation failed: the result is not a version 5 UUID.');
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
