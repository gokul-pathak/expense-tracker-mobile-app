/**
 * Closing the SQLite cursor that reading a single row leaves open.
 *
 * `expo-sqlite` executes a prepared statement by stepping it once and handing
 * back a lazy result. Draining that result with `getAllSync()` steps to the end
 * and the statement finishes. Taking only the first row with `getFirstSync()`
 * returns the row already in hand and stops there — so if the query had a row to
 * give, the statement is left mid-cursor, and this driver never finalizes it.
 *
 * Outside a transaction nothing goes wrong: re-executing a statement resets it,
 * and there is no commit to obstruct. Inside one it is fatal. SQLite refuses to
 * commit while any statement on the connection is still stepping, so the commit
 * fails with
 *
 *     cannot commit transaction - SQL statements in progress
 *
 * and the whole write rolls back. Every domain write here reads a row inside a
 * transaction — `insert(...).returning().get()` is the shape of every create —
 * so on a device this made saving anything fail, while the tests, which run
 * against `node:sqlite`, kept passing: that driver drains and resets on its own.
 *
 * The fix belongs here rather than at seventy call sites. Reading one row and
 * leaving the cursor open is a property of the driver, not of any query, and a
 * rule that every `get()` inside a transaction must be written some other way is
 * one nobody could be expected to keep.
 *
 * Structural types, deliberately: this module must be testable without importing
 * `expo-sqlite`, which is a native module and cannot load off-device.
 */

export type CursorResult = {
  getFirstSync: () => unknown;
  resetSync: () => unknown;
};

export type CursorStatement = {
  executeSync: (...params: never[]) => CursorResult;
  executeForRawResultSync: (...params: never[]) => CursorResult;
};

export type CursorClient = {
  prepareSync: (source: string) => CursorStatement;
};

/** The execute methods whose result can be left holding an open cursor. */
const EXECUTE_METHODS = new Set(['executeSync', 'executeForRawResultSync']);

/**
 * Wraps a database so every statement it prepares releases its cursor after a
 * single-row read. Everything else is forwarded untouched.
 */
export function closeCursorsAfterFirstRow<TClient extends CursorClient>(client: TClient): TClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== 'prepareSync' || typeof value !== 'function') {
        return bindIfMethod(value, target);
      }
      return (source: string) => wrapStatement(client.prepareSync(source));
    },
  });
}

function wrapStatement(statement: CursorStatement): CursorStatement {
  return new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (!EXECUTE_METHODS.has(String(property)) || typeof value !== 'function') {
        return bindIfMethod(value, target);
      }
      const execute = value as (...params: never[]) => CursorResult;
      return (...params: never[]) => releaseCursorAfterFirstRow(execute.apply(target, params));
    },
  });
}

/**
 * Replaces `getFirstSync` with one that resets the statement once the row is in
 * hand. `getAllSync` needs no help: it steps to the end, which finishes the
 * statement by itself.
 */
function releaseCursorAfterFirstRow(result: CursorResult): CursorResult {
  const getFirstSync = result.getFirstSync.bind(result);
  Object.defineProperty(result, 'getFirstSync', {
    value: () => {
      try {
        return getFirstSync();
      } finally {
        // Reset even when the read threw. A statement left mid-cursor is never
        // finalized by this driver, so one failure would go on blocking every
        // later commit on this connection.
        try {
          result.resetSync();
        } catch {
          // Resetting reports the failed step's own error. The original throw is
          // the one worth seeing, so it must not be replaced by this.
        }
      }
    },
    enumerable: true,
    writable: false,
    configurable: true,
  });
  return result;
}

function bindIfMethod(value: unknown, target: object): unknown {
  return typeof value === 'function' ? value.bind(target) : value;
}
