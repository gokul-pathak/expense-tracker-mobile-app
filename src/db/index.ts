import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import { closeCursorsAfterFirstRow } from './expo-cursors';

export const expoDb = closeCursorsAfterFirstRow(openDatabaseSync('expense_tracker.db'));

// These connection-level settings are safe to apply every time the app opens.
expoDb.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/**
 * The one database connection.
 *
 * It is wrapped so that reading a single row cannot leave a statement stepping.
 * `src/db/expo-cursors.ts` explains why: without it, every write that reads a row
 * inside a transaction fails at commit on a real device.
 */
export const db = drizzle(expoDb);
