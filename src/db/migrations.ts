import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../../drizzle/migrations';

import { db } from './index';
import { runSeed } from './seed';

let initializationPromise: Promise<void> | undefined;

export function initializeDatabase() {
  initializationPromise ??= migrate(db, migrations)
    .then(() => runSeed())
    .catch(handleMigrationFailure);

  return initializationPromise;
}

function handleMigrationFailure(error: unknown): never {
  initializationPromise = undefined;
  throw error;
}
