import { eq } from 'drizzle-orm';

import { db } from './index';
import { appMetadata } from './schema';

const persistenceCheckKey = '__m1a_persistence_check__';
const persistenceCheckValue = 'verified';

/**
 * Manually invoke in a development build before and after a restart to verify
 * that the migrated database remains available and retains data.
 */
export async function verifyDatabasePersistence() {
  if (!__DEV__) {
    throw new Error('Database persistence verification is only available in development.');
  }

  await db
    .insert(appMetadata)
    .values({ key: persistenceCheckKey, value: persistenceCheckValue })
    .onConflictDoUpdate({
      target: appMetadata.key,
      set: { value: persistenceCheckValue },
    })
    .run();

  const record = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, persistenceCheckKey))
    .get();

  if (record?.value !== persistenceCheckValue) {
    throw new Error('Database persistence verification failed.');
  }

  return record;
}
