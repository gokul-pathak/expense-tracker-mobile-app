import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings } from '@/db/schema/settings';

export function getSettings() {
  return db.select().from(settings).where(eq(settings.id, 1)).get() ?? null;
}

export function updateDefaultCurrency(currency: string, updatedAt: Date) {
  return (
    db
      .update(settings)
      .set({ defaultCurrency: currency, updatedAt })
      .where(eq(settings.id, 1))
      .returning()
      .get() ?? null
  );
}
