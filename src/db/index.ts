import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

export const expoDb = openDatabaseSync('expense_tracker.db');

// These connection-level settings are safe to apply every time the app opens.
expoDb.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const db = drizzle(expoDb);
