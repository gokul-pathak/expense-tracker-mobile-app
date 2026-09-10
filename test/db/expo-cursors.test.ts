import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { closeCursorsAfterFirstRow } from '@/db/expo-cursors';

/**
 * The cursor a single-row read leaves open, and the commit it breaks.
 *
 * This cannot be tested against the real driver: `expo-sqlite` is a native
 * module and does not load off-device, and the `node:sqlite` driver the rest of
 * the suite runs on drains and resets by itself — which is exactly why this
 * failure reached a device with every test passing.
 *
 * So the fake below reproduces the two behaviours of `expo-sqlite` that matter,
 * copied from `node_modules/expo-sqlite/build/SQLiteStatement.js`:
 *
 * - executing steps the statement once, so a query with rows to give is left
 *   mid-cursor;
 * - `getFirstSync()` hands back the row already in hand and neither steps to the
 *   end nor resets, while `getAllSync()` steps to the end and finishes.
 *
 * and the rule SQLite itself enforces: a commit fails while any statement on the
 * connection is still stepping.
 */

type Row = { id: number };

/** The members of an `expo-sqlite` execute result that this app actually uses. */
type FakeResult = {
  getFirstSync: () => Row | null;
  getAllSync: () => Row[];
  resetSync: () => void;
  changes: number;
};

class FakeConnection {
  /** Statements that have been stepped and neither finished nor been reset. */
  readonly stepping = new Set<FakeStatement>();
  readonly prepared: string[] = [];
  /** Present only to prove the wrapper forwards what it does not handle. */
  readonly executed: string[] = [];

  constructor(private readonly rowsBySource: Record<string, Row[]>) {}

  prepareSync(source: string): FakeStatement {
    this.prepared.push(source);
    return new FakeStatement(this, this.rowsBySource[source] ?? []);
  }

  execSync(source: string): void {
    this.executed.push(source);
  }

  /** What SQLite does when a statement on the connection is still stepping. */
  commitSync(): void {
    if (this.stepping.size > 0) {
      throw new Error('cannot commit transaction - SQL statements in progress');
    }
  }
}

class FakeStatement {
  constructor(
    private readonly connection: FakeConnection,
    private readonly rows: Row[],
  ) {}

  executeSync(): FakeResult {
    // `runSync` binds and steps once. A statement with a row to return stops
    // there, holding the cursor open.
    if (this.rows.length > 0) this.connection.stepping.add(this);
    return this.makeResult();
  }

  executeForRawResultSync(): FakeResult {
    return this.executeSync();
  }

  private finish(): void {
    this.connection.stepping.delete(this);
  }

  /** The same property shape expo defines: enumerable, not writable, configurable. */
  private makeResult(): FakeResult {
    const result = {} as FakeResult;
    const define = (name: string, value: unknown) =>
      Object.defineProperty(result, name, {
        value,
        enumerable: true,
        writable: false,
        configurable: true,
      });

    // Returns the row already stepped over, and deliberately does not reset.
    define('getFirstSync', () => this.rows[0] ?? null);
    // Steps to the end, which finishes the statement.
    define('getAllSync', () => {
      this.finish();
      return this.rows;
    });
    define('resetSync', () => this.finish());
    define('changes', this.rows.length);
    return result;
  }
}

const SELECT_ONE = 'select * from accounts where id = ?';
const SELECT_NONE = 'select * from sync_outbox where entity_sync_id = ?';
const INSERT_RETURNING = 'insert into accounts values (?) returning *';

function connection() {
  return new FakeConnection({
    [SELECT_ONE]: [{ id: 1 }],
    [SELECT_NONE]: [],
    [INSERT_RETURNING]: [{ id: 7 }],
  });
}

describe('the driver defect this guards against', () => {
  it('leaves a statement stepping after a single-row read, which blocks the commit', () => {
    const raw = connection();

    const result = raw.prepareSync(INSERT_RETURNING).executeSync();
    expect(result.getFirstSync()).toEqual({ id: 7 });

    // Unwrapped, this is what a device sees on every create: the row is
    // returned, the cursor stays open, and the write is lost at commit.
    expect(raw.stepping.size).toBe(1);
    expect(() => raw.commitSync()).toThrow(/SQL statements in progress/);
  });

  it('does not affect reading every row, which steps to the end on its own', () => {
    const raw = connection();

    const result = raw.prepareSync(SELECT_ONE).executeSync();
    expect(result.getAllSync()).toEqual([{ id: 1 }]);

    expect(raw.stepping.size).toBe(0);
    expect(() => raw.commitSync()).not.toThrow();
  });
});

describe('closeCursorsAfterFirstRow', () => {
  it('releases the cursor after a single-row read, so the commit succeeds', () => {
    const raw = connection();
    const client = closeCursorsAfterFirstRow(raw);

    const result = client.prepareSync(INSERT_RETURNING).executeSync();

    // The row still comes back unchanged; only the cursor is released.
    expect(result.getFirstSync()).toEqual({ id: 7 });
    expect(raw.stepping.size).toBe(0);
    expect(() => raw.commitSync()).not.toThrow();
  });

  it('keeps a whole write transaction committable', () => {
    const raw = connection();
    const client = closeCursorsAfterFirstRow(raw);

    // The exact shape of every create in this app: insert and read the row back,
    // then read another table to decide what to queue, then commit.
    const inserted = client.prepareSync(INSERT_RETURNING).executeSync().getFirstSync();
    const pending = client.prepareSync(SELECT_NONE).executeSync().getFirstSync();
    const existing = client.prepareSync(SELECT_ONE).executeSync().getFirstSync();

    expect(inserted).toEqual({ id: 7 });
    expect(pending).toBeNull();
    expect(existing).toEqual({ id: 1 });
    expect(raw.stepping.size).toBe(0);
    expect(() => raw.commitSync()).not.toThrow();
  });

  it('releases the cursor even when the read fails', () => {
    const raw = connection();
    const statement = raw.prepareSync(SELECT_ONE);
    // A statement left stepping is never finalized by this driver, so one
    // failed read would go on blocking every later commit.
    raw.stepping.add(statement as never);

    const client = closeCursorsAfterFirstRow({
      prepareSync: (_source: string) => ({
        executeSync: () => ({
          getFirstSync: () => {
            throw new Error('step failed');
          },
          resetSync: () => raw.stepping.clear(),
        }),
        executeForRawResultSync: () => {
          throw new Error('unused');
        },
      }),
    });

    expect(() => client.prepareSync('x').executeSync().getFirstSync()).toThrow('step failed');
    expect(raw.stepping.size).toBe(0);
  });

  it('reports the read failure, not whatever resetting says about it', () => {
    const client = closeCursorsAfterFirstRow({
      prepareSync: (_source: string) => ({
        executeSync: () => ({
          getFirstSync: () => {
            throw new Error('the useful error');
          },
          // Resetting re-reports the failed step, which must not replace it.
          resetSync: () => {
            throw new Error('the useless error');
          },
        }),
        executeForRawResultSync: () => {
          throw new Error('unused');
        },
      }),
    });

    expect(() => client.prepareSync('x').executeSync().getFirstSync()).toThrow('the useful error');
  });

  it('leaves reading every row alone', () => {
    const raw = connection();
    const client = closeCursorsAfterFirstRow(raw);

    const result = client.prepareSync(SELECT_ONE).executeSync();

    expect(result.getAllSync()).toEqual([{ id: 1 }]);
    expect(raw.stepping.size).toBe(0);
  });

  it('forwards everything it does not handle', () => {
    const raw = connection();
    const client = closeCursorsAfterFirstRow(raw);

    // Pragmas and any other database method must still reach the real
    // connection, bound to it.
    client.execSync('PRAGMA foreign_keys = ON;');
    client.prepareSync(SELECT_ONE);

    expect(raw.executed).toEqual(['PRAGMA foreign_keys = ON;']);
    expect(raw.prepared).toEqual([SELECT_ONE]);
    expect(client.stepping).toBe(raw.stepping);
  });
});

describe('the one gap the wrapper cannot close', () => {
  it('has no query that reads rows back through run()', () => {
    // `run()` reads the change count off the result and discards it without
    // stepping to the end, so a `returning(...).run()` would leave the same
    // cursor open with nothing to intercept — the wrapper only reaches a read
    // that goes through `get()` or `all()`. There is no such query today, and
    // this is here so there is not one tomorrow either: the failure it causes
    // appears only on a device, only at commit, and names no query at all.
    const offenders = sourceFiles().filter((file) =>
      /\.returning\([^)]*\)\s*\.run\(/s.test(file.source),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        files.push({
          path: relative(projectRoot, full).replaceAll('\\', '/'),
          source: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(join(projectRoot, 'src'));
  return files;
}
