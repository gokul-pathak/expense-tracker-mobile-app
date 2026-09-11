import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import { runSeed } from '@/db/seed';
import { assertSyncFoundationReady } from '@/db/sync-integrity';
import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import * as categoryService from '@/features/categories/category.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  closeTestDatabase,
  createTestDatabase,
  listMigrationNames,
  migrateTestDatabase,
  rawClient,
} from '../support/test-database';

/**
 * Upgrading an existing installation.
 *
 * A device that has been in use since an earlier milestone must keep working
 * after an update. Every sync milestone added columns or tables the write path
 * now depends on, so a migration that does not reach the device shows up as a
 * plain "something went wrong" the first time somebody adds an account — the
 * failure is in the upgrade, not in the feature.
 *
 * Each case writes its legacy rows with raw SQL, the way the older build would
 * have, then migrates, then uses today's services.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const financialDate = new Date(2026, 0, 15);

/** Every shipped schema a device could still be sitting on. */
const MILESTONES = [
  ['M1, before sync existed', '20260904151616_damp_raider'],
  ['M7C, sync foundation', '20260907120000_sync_foundation'],
  ['M7D, push', '20260907180000_push_sync'],
  ['M7E, pull', '20260907210000_pull_sync'],
  ['M7F, cloud link', '20260908090000_cloud_link'],
  ['M8A/M8B, budgets', '20260909120000_budgets'],
] as const;

function insertLegacyAccount(name: string, withSyncId: boolean) {
  const now = Date.now();
  if (withSyncId) {
    rawClient()
      .prepare(
        'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(name, 'cash', 100000, 'NPR', 0, now, now, '11111111-1111-4111-8111-111111111111');
    return;
  }
  rawClient()
    .prepare(
      'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(name, 'cash', 100000, 'NPR', 0, now, now);
}

describe('upgrading an existing database', () => {
  afterAll(() => closeTestDatabase());

  it('registers every migration folder with the device migrator', () => {
    // The test harness reads the folders directly, so a folder that exists but
    // is not registered stays green here and never runs on a real device.
    const source = readFileSync(join(projectRoot, 'drizzle/migrations.js'), 'utf8');

    for (const name of listMigrationNames()) {
      expect(source, name).toContain(`./${name}/migration.sql`);
      expect(source, name).toContain(`'${name}'`);
    }
  });

  it('keeps migration folder names in increasing timestamp order', () => {
    // The Expo migrator sorts by name and takes its ordering from the first
    // fourteen characters, so a name out of order would silently skip work.
    const timestamps = listMigrationNames().map((name) => name.slice(0, 14));

    expect([...timestamps].sort()).toEqual(timestamps);
    for (const timestamp of timestamps) expect(timestamp).toMatch(/^\d{14}$/);
  });

  it('puts exactly one statement in each migration chunk', () => {
    // The Expo migrator prepares each chunk as a single statement, so anything
    // after the first in a chunk is silently skipped while the migration is
    // still recorded as applied.
    for (const name of listMigrationNames()) {
      const sql = readFileSync(join(projectRoot, 'drizzle', name, 'migration.sql'), 'utf8');
      for (const chunk of sql.split('--> statement-breakpoint')) {
        const statements = chunk
          .split(';')
          .map((part) => part.trim())
          .filter((part) => part.length > 0 && !part.startsWith('--'));
        expect(statements.length, `${name}: ${chunk.slice(0, 60)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  for (const [label, through] of MILESTONES) {
    it(`upgrades a database from ${label} and can still add an account`, async () => {
      createTestDatabase({ through });
      insertLegacyAccount('Existing', through !== '20260904151616_damp_raider');

      migrateTestDatabase();
      // Startup does this before anything reads or writes.
      assertSyncFoundationReady();
      await runSeed();

      const created = accountService.createAccount({
        name: 'Added after upgrade',
        type: 'bank',
        openingBalanceMinor: 250000,
        currency: 'NPR',
      });

      expect(created.syncId).not.toBeNull();
      expect(accountService.listAccounts()).toHaveLength(2);
      // The pre-existing row was given an identity by the backfill.
      expect(accountService.listAccounts().every((account) => account.syncId !== null)).toBe(true);
      expect(verifySyncIntegrity().issues).toEqual([]);
    });
  }

  it('records a transaction on an upgraded database', async () => {
    createTestDatabase({ through: '20260907180000_push_sync' });
    insertLegacyAccount('Cash', true);
    migrateTestDatabase();
    assertSyncFoundationReady();
    await runSeed();

    const cash = accountService.listAccounts()[0]!;
    transactionService.createExpense({
      accountId: cash.id,
      categoryId: categoryService.listExpenseCategories()[0]!.id,
      amountMinor: 5000,
      title: 'Lunch',
      paymentMode: 'cash',
      transactionDate: financialDate,
    });

    expect(transactionService.listTransactions()).toHaveLength(1);
    expect(countPendingSyncMutations()).toBeGreaterThan(0);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('adds budgets to an M7 database without inventing any', async () => {
    // A device that has been in use since M7 and has never heard of budgets.
    createTestDatabase({ through: '20260908090000_cloud_link' });
    insertLegacyAccount('Existing', true);
    const before = rawClient().prepare('SELECT count(*) AS total FROM accounts').get();

    migrateTestDatabase();
    assertSyncFoundationReady();
    await runSeed();

    // The financial data survives, the new table exists, and nothing created a
    // budget nobody asked for.
    expect(rawClient().prepare('SELECT count(*) AS total FROM accounts').get()).toEqual(before);
    expect(budgetService.listBudgets()).toEqual([]);
    expect(countPendingSyncMutations()).toBe(0);

    // And the domain works on top of the upgraded database.
    const budget = budgetService.createBudget({ periodMonth: '2026-09', amountMinor: 400000 });
    expect(budget.syncId).not.toBeNull();
    expect(countPendingSyncMutations()).toBe(1);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('gives a fresh install an empty budget table and no seeded budget work', async () => {
    createTestDatabase();
    await runSeed();

    expect(budgetService.listBudgets()).toEqual([]);
    expect(budgetService.getMonthlyBudgetSummary('2026-09').totalBudgetedMinor).toBeNull();
    // The default categories are intact, and seeding queued nothing: seeding is
    // not a user mutation, and a budget is never inferred.
    expect(categoryService.listExpenseCategories().length).toBeGreaterThan(0);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().counts.budgets).toBe(0);
  });

  it('ends every upgrade path with the same schema as a fresh install', async () => {
    createTestDatabase();
    await runSeed();
    const fresh = describeSchema();

    for (const [label, through] of MILESTONES) {
      createTestDatabase({ through });
      migrateTestDatabase();
      expect(describeSchema(), label).toEqual(fresh);
    }
    // Five databases, each migrated from scratch; the budget is for slow
    // machines, not for the migrations themselves.
  }, 60_000);
});

/** Table and column shape, so an upgrade cannot quietly diverge from a fresh install. */
function describeSchema() {
  const tables = rawClient()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String((row as { name: unknown }).name))
    .filter((name) => !name.startsWith('__'))
    .sort();

  return tables.map((table) => ({
    table,
    columns: rawClient()
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String((row as { name: unknown }).name))
      .sort(),
  }));
}

describe('a database that missed a migration', () => {
  afterAll(() => closeTestDatabase());

  it('fails at startup with an actionable message instead of at the first save', () => {
    // Exactly what a stale bundle leaves behind: the older migrations applied,
    // the newer ones never delivered.
    createTestDatabase({ through: '20260907180000_push_sync' });

    // It names the first table whose shape this build no longer recognises, and
    // says what to do about it.
    expect(() => assertSyncFoundationReady()).toThrow(/is missing or out of date/);
    expect(() => assertSyncFoundationReady()).toThrow(/migration has not been applied/);
    expect(() => assertSyncFoundationReady()).toThrow(/expo start -c/);
  });

  it('starts cleanly once the missing migration is applied', async () => {
    createTestDatabase({ through: '20260907180000_push_sync' });
    migrateTestDatabase();

    expect(() => assertSyncFoundationReady()).not.toThrow();
    await runSeed();
    expect(() =>
      accountService.createAccount({
        name: 'Works now',
        type: 'cash',
        openingBalanceMinor: 0,
        currency: 'NPR',
      }),
    ).not.toThrow();
  });
});
