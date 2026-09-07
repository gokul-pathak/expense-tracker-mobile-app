import { randomUUID as nodeRandomUUID } from 'node:crypto';

/**
 * Node stand-in for the `expo-crypto` native module, aliased in `vitest.config.mjs`.
 * It provides the same RFC 4122 v4 UUID contract the app relies on offline.
 */
export function randomUUID(): string {
  return nodeRandomUUID();
}
