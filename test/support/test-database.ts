import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

/**
 * Real SQLite for tests.
 *
 * Test files replace `@/db` with this module, so repositories run their actual
 * SQL. Migrations are applied exactly the way the Expo migrator applies them —
 * split on `--> statement-breakpoint`, each chunk prepared as a single
 * statement — so a migration file that would silently half-apply on a device
 * fails here too.
 */

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

type Connection = { client: DatabaseSync; orm: NodeSQLiteDatabase };

let connection: Connection | undefined;
let directory: string | undefined;
let databasePath: string | undefined;

function active(): Connection {
  if (connection === undefined) {
    throw new Error('Call createTestDatabase() before using the test database.');
  }
  return connection;
}

/** Stable handle: reopening the database swaps the target behind this proxy. */
export const db = new Proxy({} as NodeSQLiteDatabase, {
  get(_target, property) {
    const orm = active().orm as unknown as Record<string | symbol, unknown>;
    const value = orm[property];
    return typeof value === 'function' ? value.bind(orm) : value;
  },
});

export const expoDb = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const client = active().client as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export type TestDatabaseOptions = {
  /** Apply migrations only up to and including this folder name. */
  through?: string;
};

/** Fresh on-disk database with all migrations applied. */
export function createTestDatabase(options: TestDatabaseOptions = {}) {
  closeTestDatabase();
  directory = mkdtempSync(join(tmpdir(), 'pet-sync-'));
  databasePath = join(directory, 'test.db');
  open();
  runMigrations(options.through);
}

/** Simulates an app restart: the file survives, the connection does not. */
export function reopenTestDatabase() {
  if (databasePath === undefined) throw new Error('No test database to reopen.');
  connection?.client.close();
  connection = undefined;
  open();
}

/** Applies any migrations not yet run, as a later app version would. */
export function migrateTestDatabase(through?: string) {
  runMigrations(through);
}

export function closeTestDatabase() {
  connection?.client.close();
  connection = undefined;
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  databasePath = undefined;
}

export function rawClient() {
  return active().client;
}

export function listMigrationNames(): string[] {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function open() {
  const client = new DatabaseSync(databasePath!);
  client.exec('PRAGMA foreign_keys = ON;');
  connection = { client, orm: drizzle({ client }) };
}

function runMigrations(through?: string) {
  const client = active().client;
  client.exec(
    'CREATE TABLE IF NOT EXISTS __test_migrations (name text PRIMARY KEY, applied_at text)',
  );
  const applied = new Set(
    client
      .prepare('SELECT name FROM __test_migrations')
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );

  for (const name of listMigrationNames()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDirectory, name, 'migration.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      client.prepare(trimmed).run();
    }
    client
      .prepare('INSERT INTO __test_migrations (name, applied_at) VALUES (?, ?)')
      .run(name, new Date().toISOString());
    if (through !== undefined && name === through) return;
  }
}
