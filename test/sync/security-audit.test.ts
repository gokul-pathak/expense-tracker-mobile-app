import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import { createBackup } from '@/features/backup/backup.service';
import { exportFullDataJson, exportTransactionsJson } from '@/features/export/export.service';
import { readSupabaseConfig } from '@/lib/supabase/config';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { updateSyncState } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';
import * as accountService from '@/features/accounts/account.service';

import { cloudAccount, OTHER_USER, TEST_USER } from '../support/cloud-rows';
import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

/**
 * The release audit: the things that must be true before anyone's financial
 * records are allowed near a server.
 *
 * These are deliberately blunt, repo-wide checks rather than unit tests. A
 * service-role key or a logged session does not fail a behavioural test — it
 * fails quietly, in production, once.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

/**
 * Code only. These audits are about what the app does, not about the prose
 * explaining it — a comment saying "never stores tokens" must not read as a
 * violation of itself.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Every source file that ships in the app bundle. */
function clientSources(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      files.push({
        path: relative(projectRoot, full).replaceAll('\\', '/'),
        source: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(join(projectRoot, 'src'));
  return files;
}

describe('service role audit', () => {
  it('has no service-role key anywhere in the client', () => {
    const offenders = clientSources().filter(({ source }) =>
      /service_role|serviceRole|SERVICE_ROLE/.test(source),
    );

    // A service-role key in a mobile bundle bypasses every row level security
    // policy for every user. There is no acceptable count above zero.
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('has no service-role key in the app configuration or environment contract', () => {
    for (const path of ['app.json', 'package.json', '.env.example']) {
      let source: string;
      try {
        source = read(path);
      } catch {
        continue;
      }
      expect(source, path).not.toMatch(/service_role|SERVICE_ROLE/);
      expect(source, path).not.toMatch(/DATABASE_PASSWORD|POSTGRES_PASSWORD/);
    }
  });

  it('reaches the cloud only through the authenticated client', () => {
    const adapter = read('src/features/sync/remote/supabase-sync.repository.ts');
    expect(adapter).toMatch(/getSupabaseClient/);
    expect(adapter).not.toMatch(/createClient\(/);
    // One module speaks PostgREST; everything else goes through it.
    const speakers = clientSources().filter(
      ({ path, source }) =>
        path !== 'src/lib/supabase/client.ts' &&
        path !== 'src/features/sync/remote/supabase-sync.repository.ts' &&
        /\.schema\(|\.from\(['"`]/.test(source),
    );
    expect(speakers.map((file) => file.path)).toEqual([]);
  });
});

describe('environment audit', () => {
  it('reads only public Expo configuration', () => {
    const config = read('src/lib/supabase/config.ts');

    expect(config).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
    expect(config).toMatch(/EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(config).not.toMatch(/SERVICE|SECRET|PASSWORD|ANON_SECRET/);
  });

  it('leaves the app in local-only mode when nothing is configured', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://example.test' })).toBeNull();
    // A misnamed variable must not half-configure the client.
    expect(
      readSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key',
      }),
    ).toBeNull();
  });

  it('refuses a malformed cloud URL rather than guessing', () => {
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'not a url',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key',
      }),
    ).toBeNull();
  });
});

describe('token and credential audit', () => {
  it('keeps session material out of every sync and domain module', () => {
    const offenders = clientSources().filter(
      ({ path, source }) =>
        path.startsWith('src/features/sync/') &&
        /access_token|refresh_token|accessToken|refreshToken|Authorization|Bearer /.test(
          code(source),
        ),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('stores the session only in the platform secure store', () => {
    const storage = code(read('src/lib/supabase/storage.native.ts'));

    expect(storage).toMatch(/expo-secure-store/);
    // Never SQLite, and never an unencrypted key-value store.
    expect(storage).not.toMatch(/AsyncStorage|from '@\/db'|expo-sqlite/);
  });

  it('keeps every sync table free of anything that looks like a credential', () => {
    const schema = code(read('src/db/schema/sync.ts'));

    // Column definitions only: the surrounding comments are allowed to say the
    // word "token" precisely because no column does.
    expect(schema).not.toMatch(/text\('[^']*(token|password|secret|jwt|session)/i);
    expect(schema).not.toMatch(/int\('[^']*(token|password|secret)/i);
  });
});

describe('app lock audit', () => {
  it('never lets cloud sync read or write device lock state', () => {
    const offenders = clientSources().filter(
      ({ path, source }) =>
        path.startsWith('src/features/sync/') &&
        /expo-secure-store|SecureStore|app-lock|biometric/i.test(code(source)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('keeps lock credentials out of the cloud row contracts', () => {
    for (const path of [
      'src/features/sync/remote/remote-rows.ts',
      'src/features/sync/remote/remote-pull-rows.ts',
      'src/features/sync/mapping/local-to-remote.ts',
      'src/features/sync/mapping/remote-to-local.ts',
    ]) {
      const source = code(read(path));
      expect(source, path).not.toMatch(/PIN|biometric|appLock|app_lock|failedAttempts/i);
    }
  });

  it('keeps lock credentials out of the cloud schema', () => {
    const migration = read('supabase/migrations/20260907000000_cloud_sync.sql');

    expect(migration).not.toMatch(/pin|biometric|app_lock|password|token/i);
  });
});

describe('logging and privacy audit', () => {
  it('logs no financial or session values from the sync engine', () => {
    const offenders = clientSources().filter(
      ({ path, source }) =>
        path.startsWith('src/features/sync/') &&
        /console\.(log|info|debug|warn)/.test(code(source)),
    );

    // The engine reports through typed results; a stray log is how an amount or
    // a note ends up in a device log or a crash report.
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('carries only classification codes in durable failure metadata', () => {
    const repository = read('src/features/sync/sync.repository.ts');

    expect(repository).toMatch(/MAX_ERROR_CODE_LENGTH/);
    // A remote response body must never be persisted next to the queue.
    expect(repository).not.toMatch(/JSON\.stringify\(.*(response|error)/);
  });

  it('never puts a remote row or a session into an error message', () => {
    const adapter = read('src/features/sync/remote/supabase-sync.repository.ts');

    expect(adapter).toMatch(/never a row or a response body/);
    expect(adapter).not.toMatch(/JSON\.stringify/);
  });
});

describe('exported and backed-up data audit', () => {
  beforeEach(async () => {
    await setupDatabase();
    updateSyncState({ linkedUserId: TEST_USER });
  });
  afterAll(() => closeTestDatabase());

  it('keeps sync runtime state and credentials out of a backup', () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: expenseCategory().id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: new Date(2026, 0, 15),
    });

    const serialized = JSON.stringify(createBackup());

    // Identity travels so a restore keeps its cloud records.
    expect(serialized).toContain(cash.syncId!);
    // Nothing about the cloud relationship or the session does.
    for (const forbidden of [
      'linked_user_id',
      'linkedUserId',
      'pull_cursor',
      'pullCursor',
      'sync_outbox',
      'access_token',
      'refresh_token',
      TEST_USER,
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('keeps the same material out of every export', () => {
    makeAccount('Cash', 'NPR', 100000);

    for (const serialized of [exportFullDataJson(), exportTransactionsJson()]) {
      for (const forbidden of ['access_token', 'refresh_token', 'linkedUserId', TEST_USER]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('stores no cloud identity of the user in the local sync tables', () => {
    const columns = rawClient()
      .prepare('PRAGMA table_info(sync_outbox)')
      .all()
      .map((row) => String((row as { name: unknown }).name));

    // The queue stores intent and identity, never ownership or credentials.
    expect(columns).not.toContain('user_id');
    expect(columns).not.toContain('token');
  });
});

describe('untrusted remote data defence', () => {
  let cloud: FakeCloud;

  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
    updateSyncState({ linkedUserId: TEST_USER });
  });

  function pull() {
    return pullRemoteChanges({
      dependencies: {
        getAuthenticatedUserId: async () => TEST_USER,
        createRemote: () => cloud.pullRepository,
      },
    });
  }

  it('rejects a row belonging to another account even if the server sends it', async () => {
    // Row level security should make this impossible. The client checks anyway,
    // because a client with no defence of its own has none left when that
    // assumption breaks.
    cloud.putRow('account', cloudAccount({ user_id: OTHER_USER, name: 'Someone else' }));

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]?.code).toBe('foreign_owner');
    expect(accountService.listAccounts()).toHaveLength(0);
  });

  it('rejects a change-feed entry belonging to another account', async () => {
    cloud.putRow('account', cloudAccount({ name: 'Mine' }));
    await pull();

    // A feed row that names another owner is refused before any row is fetched.
    const foreign = cloudAccount({ user_id: OTHER_USER });
    cloud.enforceOwner(null);
    cloud.putRow('account', foreign);

    const result = await pull();

    expect(result.failures.some((failure) => failure.code === 'foreign_owner')).toBe(true);
    expect(accountService.listAccounts()).toHaveLength(1);
  });

  it('leaves the database untouched when a downloaded row is malformed', async () => {
    const cash = makeAccount('Cash', 'NPR', 100000);
    const balanceBefore = accountService.getAccount(cash.id).openingBalanceMinor;
    cloud.putRow('account', { ...cloudAccount(), opening_balance_minor: 'not a number' });

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(accountService.listAccounts()).toHaveLength(1);
    expect(accountService.getAccount(cash.id).openingBalanceMinor).toBe(balanceBefore);
  });
});
