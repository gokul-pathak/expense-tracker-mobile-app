import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/db/schema';
import { countPendingSyncMutations, getSyncState } from '@/features/sync/sync.repository';

import { makeAccount, setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every module allowed to write local financial data or queue cloud work. */
const localWritePaths = [
  'src/db/seed.ts',
  'src/db/sync-integrity.ts',
  'src/features/accounts/account.repository.ts',
  'src/features/accounts/account.service.ts',
  'src/features/categories/category.repository.ts',
  'src/features/categories/category.service.ts',
  'src/features/people/person.repository.ts',
  'src/features/people/person.service.ts',
  'src/features/settings/settings.repository.ts',
  'src/features/settings/settings.service.ts',
  'src/features/transactions/transaction.repository.ts',
  'src/features/transactions/transaction.service.ts',
  'src/features/backup/backup.service.ts',
  'src/features/sync/sync.repository.ts',
  'src/features/sync/remote-apply.repository.ts',
  'src/features/sync/sync.types.ts',
  'src/features/sync/uuid.ts',
];

function read(path: string) {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('M7C boundaries', () => {
  it('keeps Supabase out of every local financial write path', () => {
    for (const path of localWritePaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/supabase/i);
      expect(source, path).not.toMatch(/cloud-auth/);
      expect(source, path).not.toMatch(/\bfetch\(/);
    }
  });

  it('adds no push, pull, realtime, or automatic sync trigger', () => {
    for (const path of localWritePaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/syncNow|pushSync|pullSync|realtime|subscribe\(/i);
    }
  });

  it('never conditions local sync bookkeeping on an active cloud session', () => {
    const source = read('src/features/sync/sync.repository.ts');
    expect(source).not.toMatch(/isSignedIn|session|getUser|accessToken|refreshToken/i);
  });

  it('centralizes the sync vocabulary instead of comparing loose strings', () => {
    expect(SYNC_ENTITY_TYPES).toEqual(['account', 'category', 'person', 'transaction', 'settings']);
    expect(SYNC_OPERATIONS).toEqual(['upsert', 'delete']);
  });

  describe('with a real database', () => {
    beforeEach(async () => {
      await setupDatabase();
    });
    afterAll(() => closeTestDatabase());

    it('stores intent in the outbox, never a copy of the financial record', () => {
      makeAccount('Cash', 'NPR', 123456);
      const columns = rawClient()
        .prepare('PRAGMA table_info(sync_outbox)')
        .all()
        .map((row) => String((row as { name: unknown }).name));

      expect(columns).toEqual([
        'id',
        'entity_type',
        'entity_sync_id',
        'operation',
        'created_at',
        'attempt_count',
        'last_error',
      ]);
      const rows = rawClient().prepare('SELECT * FROM sync_outbox').all();
      expect(JSON.stringify(rows)).not.toContain('123456');
    });

    it('records local work while the database is unlinked and signed out', () => {
      makeAccount('Cash');

      expect(getSyncState()?.linkedUserId).toBeNull();
      expect(countPendingSyncMutations()).toBe(1);
    });

    it('keeps no user-facing sync status string in durable state', () => {
      const columns = rawClient()
        .prepare('PRAGMA table_info(sync_state)')
        .all()
        .map((row) => String((row as { name: unknown }).name));

      expect(columns).toEqual([
        'singleton_id',
        'linked_user_id',
        'pull_cursor',
        'last_successful_sync_at',
        'last_sync_error',
      ]);
    });
  });
});
