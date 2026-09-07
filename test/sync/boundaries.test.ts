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
  'src/features/sync/sync-source.repository.ts',
  'src/features/sync/remote-apply.repository.ts',
  'src/features/sync/sync.types.ts',
  'src/features/sync/uuid.ts',
  'src/features/sync/mapping/local-to-remote.ts',
];

/** The one module allowed to reach the cloud, and the orchestration above it. */
const pushPaths = [
  'src/features/sync/push-sync.service.ts',
  'src/features/sync/push-sync.types.ts',
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

  it('keeps local write paths free of push orchestration', () => {
    for (const path of localWritePaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/pushPendingChanges|realtime|subscribe\(/i);
    }
  });

  it('confines cloud data access to the Supabase sync repository', () => {
    for (const path of pushPaths) {
      const source = read(path);
      // Orchestration may name the adapter but must not speak PostgREST itself.
      expect(source, path).not.toMatch(/\.from\(|\.schema\(/);
    }
    const adapter = read('src/features/sync/remote/supabase-sync.repository.ts');
    expect(adapter).toMatch(/\.schema\(REMOTE_SCHEMA\)/);
    // Push writes only: downloading cloud rows belongs to Pull Sync.
    expect(adapter).not.toMatch(/\.select\(|\.eq\(/);
  });

  it('adds no pull sync, realtime, or background scheduler', () => {
    for (const path of [...pushPaths, 'src/features/sync/remote/supabase-sync.repository.ts']) {
      const source = read(path);
      expect(source, path).not.toMatch(/applyRemote|pullCursor|realtime|channel\(/i);
      expect(source, path).not.toMatch(/setInterval|setTimeout|BackgroundFetch|TaskManager/);
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
        'revision',
        'last_attempt_at',
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
        'last_successful_push_at',
      ]);
    });
  });
});
