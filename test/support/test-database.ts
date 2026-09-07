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
 *
 * More than one database can exist at a time, each standing for one device.
 * `useTestDevice` switches which one the `db` proxy resolves to, so a two-device
 * synchronization scenario runs against two genuinely separate databases rather
 * than a simulation of one.
 */

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const DEFAULT_DEVICE = 'default';

type Device = {
  client: DatabaseSync;
  orm: NodeSQLiteDatabase;
  directory: string;
  path: string;
};

const devices = new Map<string, Device>();
let activeName: string | undefined;

function active(): Device {
  const device = activeName === undefined ? undefined : devices.get(activeName);
  if (device === undefined) {
    throw new Error('Call createTestDatabase() before using the test database.');
  }
  return device;
}

/** Stable handle: switching device or reopening swaps the target behind this proxy. */
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

/** Fresh on-disk database with all migrations applied, replacing any existing one. */
export function createTestDatabase(options: TestDatabaseOptions = {}) {
  closeTestDatabase();
  createTestDevice(DEFAULT_DEVICE, options);
}

/**
 * An additional device with its own database file, and its own seed identities.
 * Two devices seed the same built-in categories independently, which is exactly
 * the reconciliation case a second device has to survive.
 */
export function createTestDevice(name: string, options: TestDatabaseOptions = {}) {
  devices.get(name)?.client.close();
  const directory = mkdtempSync(join(tmpdir(), `pet-sync-${name}-`));
  const path = join(directory, 'test.db');
  devices.set(name, { ...open(path), directory, path });
  activeName = name;
  runMigrations(options.through);
}

/** Points every repository at one device's database. */
export function useTestDevice(name: string = DEFAULT_DEVICE) {
  if (!devices.has(name)) throw new Error(`No test device named "${name}".`);
  activeName = name;
}

/** Simulates an app restart: the file survives, the connection does not. */
export function reopenTestDatabase() {
  const device = active();
  device.client.close();
  devices.set(activeName!, {
    ...open(device.path),
    directory: device.directory,
    path: device.path,
  });
}

/** Applies any migrations not yet run, as a later app version would. */
export function migrateTestDatabase(through?: string) {
  runMigrations(through);
}

export function closeTestDatabase() {
  for (const device of devices.values()) {
    device.client.close();
    rmSync(device.directory, { recursive: true, force: true });
  }
  devices.clear();
  activeName = undefined;
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

function open(path: string) {
  const client = new DatabaseSync(path);
  client.exec('PRAGMA foreign_keys = ON;');
  return { client, orm: drizzle({ client }) };
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
