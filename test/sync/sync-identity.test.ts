import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { runSeed } from '@/db/seed';
import { isSyncId } from '@/db/schema';
import { assertSyncFoundationReady } from '@/db/sync-integrity';
import { listCategories } from '@/features/categories/category.service';
import { getAppSettings } from '@/features/settings/settings.service';
import { countPendingSyncMutations, getSyncState } from '@/features/sync/sync.repository';

import { setupDatabase } from '../support/domain';
import {
  closeTestDatabase,
  createTestDatabase,
  listMigrationNames,
  migrateTestDatabase,
  rawClient,
  reopenTestDatabase,
} from '../support/test-database';

const PRE_SYNC_MIGRATION = '20260904151616_damp_raider';
const SYNC_MIGRATION = '20260907120000_sync_foundation';

function selectAll(sql: string) {
  return rawClient().prepare(sql).all() as Record<string, unknown>[];
}

/** Builds a pre-M7C database holding real financial history. */
function createLegacyDatabase(transactionCount = 3) {
  createTestDatabase({ through: PRE_SYNC_MIGRATION });
  const client = rawClient();
  client.exec(`
    INSERT INTO accounts (id, name, type, opening_balance_minor, currency, icon, is_archived, created_at, updated_at)
      VALUES (1, 'Cash', 'cash', 100000, 'NPR', NULL, 0, 1000, 1000);
    INSERT INTO categories (id, name, type, icon, system_key, is_default, created_at, updated_at)
      VALUES (1, 'Food', 'expense', 'food', 'expense_food', 1, 1000, 1000);
    INSERT INTO people (id, name, note, is_archived, created_at, updated_at)
      VALUES (1, 'Ram', NULL, 0, 1000, 1000);
    INSERT INTO settings (id, default_currency, created_at, updated_at) VALUES (1, 'NPR', 1000, 1000);
    INSERT INTO app_metadata (key, value) VALUES ('seed.categories.version', '1');
  `);
  const insert = client.prepare(
    `INSERT INTO transactions
       (id, type, amount_minor, currency, category_id, source_account_id, payment_mode, transaction_date, title, note, created_at, updated_at)
     VALUES (?, 'expense', ?, 'NPR', 1, 1, 'cash', ?, ?, NULL, ?, ?)`,
  );
  client.exec('BEGIN');
  for (let index = 1; index <= transactionCount; index += 1) {
    insert.run(index, index * 100, 500_000 + index, `Legacy ${index}`, 2000 + index, 2000 + index);
  }
  client.exec('COMMIT');
}

describe('global sync identity', () => {
  afterAll(() => closeTestDatabase());

  it('registers every migration folder in the Expo migration manifest', async () => {
    const manifest = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../drizzle/migrations.js', import.meta.url), 'utf8'),
    );
    for (const name of listMigrationNames()) expect(manifest).toContain(name);
  });

  it('gives every seeded row a stable sync identity without queueing cloud work', async () => {
    await setupDatabase();

    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) expect(isSyncId(category.syncId)).toBe(true);
    expect(isSyncId(getAppSettings().syncId)).toBe(true);
    // Seeding is not a user mutation.
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('keeps seeded identity stable when initialization runs again', async () => {
    await setupDatabase();
    const before = listCategories().map((category) => [category.systemKey, category.syncId]);

    reopenTestDatabase();
    migrateTestDatabase();
    assertSyncFoundationReady();
    await runSeed();

    expect(listCategories().map((category) => [category.systemKey, category.syncId])).toEqual(
      before,
    );
    expect(listCategories()).toHaveLength(before.length);
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('backfills existing rows without touching financial history', () => {
    createLegacyDatabase();
    const before = selectAll(
      'SELECT id, created_at, updated_at, transaction_date FROM transactions',
    );

    migrateTestDatabase(SYNC_MIGRATION);

    for (const table of ['accounts', 'categories', 'people', 'settings', 'transactions']) {
      const rows = selectAll(`SELECT sync_id FROM ${table}`);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(isSyncId(row.sync_id)).toBe(true);
    }
    expect(
      selectAll('SELECT id, created_at, updated_at, transaction_date FROM transactions'),
    ).toEqual(before);
    // A migration is not a user change.
    expect(selectAll('SELECT id FROM sync_outbox')).toHaveLength(0);
  });

  it('assigns each backfilled row a distinct identity', () => {
    createLegacyDatabase(50);
    migrateTestDatabase(SYNC_MIGRATION);
    const ids = selectAll('SELECT sync_id FROM transactions').map((row) => row.sync_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps backfilled identities across a restart', () => {
    createLegacyDatabase();
    migrateTestDatabase(SYNC_MIGRATION);
    const before = selectAll('SELECT id, sync_id FROM transactions ORDER BY id');

    reopenTestDatabase();
    migrateTestDatabase();

    expect(selectAll('SELECT id, sync_id FROM transactions ORDER BY id')).toEqual(before);
  });

  it('enforces sync identity uniqueness in the database, not only in code', async () => {
    await setupDatabase();
    const [first, second] = selectAll('SELECT id, sync_id FROM categories ORDER BY id LIMIT 2');
    expect(() =>
      rawClient()
        .prepare('UPDATE categories SET sync_id = ? WHERE id = ?')
        .run(String(first!.sync_id), Number(second!.id)),
    ).toThrow(/UNIQUE/i);
  });

  it('creates the durable sync state as an unlinked singleton', async () => {
    await setupDatabase();
    const state = getSyncState();
    expect(state).toMatchObject({ singletonId: 1, linkedUserId: null, pullCursor: null });
    expect(selectAll('SELECT singleton_id FROM sync_state')).toHaveLength(1);
    expect(Object.keys(state ?? {})).not.toContain('accessToken');
  });

  it('blocks startup when a row is missing its sync identity', async () => {
    await setupDatabase();
    rawClient().exec('UPDATE transactions SET sync_id = NULL');
    rawClient().exec(
      `INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, transaction_date, title, created_at, updated_at, sync_id)
       VALUES ('expense', 100, 'NPR', NULL, NULL, 1, 'Orphan', 1, 1, NULL)`,
    );
    expect(() => assertSyncFoundationReady()).toThrow(/sync identit/i);
  });

  it('backfills a large dataset in one migration step', () => {
    createLegacyDatabase(5000);
    const startedAt = performance.now();
    migrateTestDatabase(SYNC_MIGRATION);
    const elapsedMs = performance.now() - startedAt;

    // eslint-disable-next-line no-console
    console.info(`5,000-row sync-ID backfill completed in ${elapsedMs.toFixed(0)}ms`);
    const missing = selectAll('SELECT id FROM transactions WHERE sync_id IS NULL');
    expect(missing).toHaveLength(0);
    const ids = selectAll('SELECT sync_id FROM transactions').map((row) => row.sync_id);
    expect(new Set(ids).size).toBe(5000);
    // Generous ceiling: this only guards against an accidental per-row round trip.
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);
});
