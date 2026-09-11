import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isSyncId } from '@/db/schema';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
  RECURRING_IDENTITY_NAMESPACE,
} from '@/features/recurring/recurring-identity';
import { createNameBasedSyncId, createSyncId } from '@/features/sync/uuid';

/**
 * Cross-device identity.
 *
 * The property everything else rests on: two devices, never having spoken, must
 * compute the same identity for the same occurrence. That is only true if the
 * algorithm is exactly RFC 4122 version 5 on every runtime the app runs on, so
 * this checks the implementation three ways — against the RFC's own published
 * example, against an independent SHA-1 computation, and against the package's
 * pure-JavaScript build, which is the code Metro ships to a phone.
 */

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const TEMPLATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** RFC 4122 section 4.3, computed with Node's own SHA-1. A test-only reference. */
function referenceV5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('name-based identity', () => {
  it('matches the published RFC 4122 version 5 example', () => {
    // Python's documented uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org').
    expect(createNameBasedSyncId(DNS_NAMESPACE, 'python.org')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('matches an independent SHA-1 computation for many names', () => {
    for (let index = 0; index < 200; index += 1) {
      const name = `recurring-occurrence:${TEMPLATE}:2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}#${index}`;
      expect(createNameBasedSyncId(RECURRING_IDENTITY_NAMESPACE, name)).toBe(
        referenceV5(RECURRING_IDENTITY_NAMESPACE, name),
      );
    }
  });

  it('agrees with the pure-JavaScript build that Metro bundles for a device', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const browserBuild = pathToFileURL(
      join(root, 'node_modules/uuid/dist/esm-browser/index.js'),
    ).href;
    const { v5 } = (await import(browserBuild)) as {
      v5: (name: string, namespace: string) => string;
    };
    for (const name of [
      'python.org',
      `recurring-occurrence:${TEMPLATE}:2026-09-01`,
      'transaction:x',
    ]) {
      expect(v5(name, RECURRING_IDENTITY_NAMESPACE)).toBe(
        createNameBasedSyncId(RECURRING_IDENTITY_NAMESPACE, name),
      );
    }
  });

  it('is a version 5 identity the sync layer accepts, alongside random version 4', () => {
    const derived = createNameBasedSyncId(RECURRING_IDENTITY_NAMESPACE, 'anything');
    expect(derived[14]).toBe('5');
    expect(isSyncId(derived)).toBe(true);

    const random = createSyncId();
    expect(random[14]).toBe('4');
    expect(isSyncId(random)).toBe(true);

    // Every other version, and the nil UUID, is still refused.
    expect(isSyncId('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isSyncId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
    expect(isSyncId('886313e1-3b8a-3372-9b90-0c9aee199e5d')).toBe(false);
  });
});

describe('recurring identity', () => {
  it('uses one fixed namespace, which must never change', () => {
    // Changing this would give every date already handled a new identity on the
    // next device to derive it — the duplication this module exists to prevent.
    expect(RECURRING_IDENTITY_NAMESPACE).toBe('1d5f200c-290b-4d0a-b974-54b7f2729dfb');
  });

  it('derives an occurrence from the template identity and the date, exactly', () => {
    expect(deriveOccurrenceSyncId(TEMPLATE, '2026-09-01')).toBe(
      referenceV5(
        '1d5f200c-290b-4d0a-b974-54b7f2729dfb',
        `recurring-occurrence:${TEMPLATE}:2026-09-01`,
      ),
    );
  });

  it('derives the generated transaction from the occurrence, exactly', () => {
    const occurrence = deriveOccurrenceSyncId(TEMPLATE, '2026-09-01');
    expect(deriveGeneratedTransactionSyncId(occurrence)).toBe(
      referenceV5('1d5f200c-290b-4d0a-b974-54b7f2729dfb', `transaction:${occurrence}`),
    );
  });

  it('gives the same answer every time and a different one for anything else', () => {
    const september = deriveOccurrenceSyncId(TEMPLATE, '2026-09-01');
    expect(deriveOccurrenceSyncId(TEMPLATE, '2026-09-01')).toBe(september);
    expect(deriveOccurrenceSyncId(TEMPLATE, '2026-10-01')).not.toBe(september);
    expect(deriveOccurrenceSyncId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-09-01')).not.toBe(
      september,
    );
    expect(deriveGeneratedTransactionSyncId(september)).not.toBe(september);
  });

  it('refuses a non-canonical input rather than deriving a second identity for it', () => {
    expect(() => deriveOccurrenceSyncId(TEMPLATE.toUpperCase(), '2026-09-01')).toThrow();
    expect(() => deriveOccurrenceSyncId(TEMPLATE, '2026-9-1')).toThrow();
    expect(() => deriveOccurrenceSyncId(TEMPLATE, '2026-02-30')).toThrow();
    expect(() => deriveGeneratedTransactionSyncId('not-an-id')).toThrow();
  });
});
