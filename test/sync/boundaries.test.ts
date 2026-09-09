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
  'src/features/sync/sync-baseline.repository.ts',
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

const pullPaths = [
  'src/features/sync/pull-sync.service.ts',
  'src/features/sync/pull-sync.types.ts',
  'src/features/sync/pull-plan.ts',
];

/** Orchestration and first-link flows, above the engines. */
const orchestrationPaths = [
  'src/features/sync/sync.service.ts',
  'src/features/sync/reconciliation.service.ts',
  'src/features/sync/initial-upload.service.ts',
  'src/features/sync/cloud-snapshot.service.ts',
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
    for (const path of [...pushPaths, ...pullPaths, ...orchestrationPaths]) {
      const source = read(path);
      // Orchestration may name the adapter but must not speak PostgREST itself.
      expect(source, path).not.toMatch(/\.from\(|\.schema\(/);
    }
    const adapter = read('src/features/sync/remote/supabase-sync.repository.ts');
    expect(adapter).toMatch(/\.schema\(REMOTE_SCHEMA\)/);
  });

  it('keeps Pull Sync out of the domain services and the device security state', () => {
    for (const path of pullPaths) {
      const source = read(path);
      // Downloaded rows go through the remote-apply path, never through the
      // services that exist to record a user's own intent.
      expect(source, path).not.toMatch(
        /features\/(accounts|categories|people|transactions|settings|dashboard|reports)\//,
      );
      // Cloud financial sync has no business with the local lock.
      expect(source, path).not.toMatch(/SecureStore|expo-secure-store|appLock|biometric|PIN/i);
    }
  });

  it('never lets cloud sync touch the device lock or its credentials', () => {
    for (const path of [...orchestrationPaths, 'src/features/sync/sync.provider.tsx']) {
      const source = read(path);
      // App Lock protects this device; it is not account state and never syncs.
      expect(source, path).not.toMatch(/SecureStore|expo-secure-store|appLock|biometric|PIN/i);
      // Session material stays with the auth layer, never in sync tables.
      expect(source, path).not.toMatch(/accessToken|refreshToken|access_token|refresh_token/);
    }
  });

  it('keeps Pull Sync read-only against the cloud', () => {
    for (const path of pullPaths) {
      const source = read(path);
      // A conflict the local side wins stays queued for a push; pull never
      // resolves one by writing to Supabase itself.
      expect(source, path).not.toMatch(
        /upsert\(|createSupabaseSyncRepository|RemoteSyncRepository/,
      );
    }
  });

  it('keeps push out of the remote-apply path and pull out of the upload path', () => {
    const remoteApply = read('src/features/sync/remote-apply.repository.ts');
    // A remote apply that queued an upload would push the same record straight back.
    expect(remoteApply).not.toMatch(/enqueueSyncMutation\(/);
    expect(read('src/features/sync/push-sync.service.ts')).not.toMatch(/applyRemote/);
  });

  it('adds no realtime, background scheduler, or automatic lifecycle trigger', () => {
    const syncPaths = [
      ...pushPaths,
      ...pullPaths,
      ...orchestrationPaths,
      'src/features/sync/remote/supabase-sync.repository.ts',
      'src/features/sync/remote/remote-pull-rows.ts',
      'src/features/sync/sync-lock.ts',
    ];
    for (const path of syncPaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/realtime|channel\(|\.on\(/i);
      expect(source, path).not.toMatch(/setInterval|setTimeout|BackgroundFetch|TaskManager/);
      // Lifecycle belongs to the provider, which is the only place allowed to
      // decide that now is a reasonable moment to sync.
      expect(source, path).not.toMatch(/AppState|addEventListener/);
    }
  });

  it('binds a database to a cloud account only through reconciliation', () => {
    // The engines read the binding; nothing but the first-link flow writes it.
    for (const path of [
      'src/features/sync/push-sync.service.ts',
      'src/features/sync/pull-sync.service.ts',
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(/updateSyncState\(\s*\{[^}]*linkedUserId/);
    }
    expect(read('src/features/sync/reconciliation.service.ts')).toMatch(
      /linkedUserId: ready\.userId/,
    );
  });

  it('never conditions local sync bookkeeping on an active cloud session', () => {
    const source = read('src/features/sync/sync.repository.ts');
    expect(source).not.toMatch(/isSignedIn|session|getUser|accessToken|refreshToken/i);
  });

  it('centralizes the sync vocabulary instead of comparing loose strings', () => {
    expect(SYNC_ENTITY_TYPES).toEqual([
      'account',
      'category',
      'person',
      'transaction',
      'settings',
      'budget',
    ]);
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
        'base_server_revision',
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
        'last_successful_pull_at',
        'pending_link_user_id',
        'reconciliation_required',
      ]);
    });

    it('records conflict metadata without duplicating the financial record', () => {
      const columns = rawClient()
        .prepare('PRAGMA table_info(sync_conflicts)')
        .all()
        .map((row) => String((row as { name: unknown }).name));

      expect(columns).toEqual([
        'id',
        'entity_type',
        'entity_sync_id',
        'local_operation',
        'base_server_revision',
        'remote_server_revision',
        'resolution',
        'detail',
        'detected_at',
      ]);
    });
  });
});
