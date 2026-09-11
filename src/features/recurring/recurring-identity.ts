import { isSyncId } from '@/db/schema';
import { createNameBasedSyncId } from '@/features/sync/uuid';

import { isLocalDate, type LocalDate } from './recurring-schedule';

/**
 * Cross-device identity for recurring occurrences and the transactions they
 * produce.
 *
 * The problem this solves: two phones, both offline, both showing "Rent due
 * September 1". Both record it. If each gave the rent a random identity, the
 * cloud would receive two different transactions and faithfully keep both, and
 * the user would have paid rent twice on paper. No amount of conflict handling
 * afterwards can fix that, because by then they genuinely are two records.
 *
 * So the identity is not chosen, it is computed — an RFC 4122 version 5 UUID of
 * the template's identity and the date. Both phones compute the same value, the
 * cloud's identity-keyed upsert converges them into one row, and the rent is
 * recorded once. The generated transaction's identity is computed the same way
 * from the occurrence's, so it converges too.
 *
 * The inputs are the template's identity and the date, and nothing else. An
 * amount, a category or a note can be edited; an identity built from them would
 * change when they did, which is the one thing an identity must never do.
 */

/**
 * The namespace every recurring identity is derived in.
 *
 * It is not a secret — it is in the source, and anyone can recompute these
 * identities. What matters is that it never changes: every occurrence and every
 * generated transaction ever recorded was derived from this exact value, and a
 * different namespace would make a device derive different identities for dates
 * already handled, which is precisely the duplication this module exists to
 * prevent. Treat it as part of the data format, like a column name.
 */
export const RECURRING_IDENTITY_NAMESPACE = '1d5f200c-290b-4d0a-b974-54b7f2729dfb';

/** `recurring-occurrence:{templateSyncId}:{YYYY-MM-DD}`. */
export function deriveOccurrenceSyncId(templateSyncId: string, occurrenceDate: LocalDate): string {
  // Only canonical inputs: an uppercase identity or `2026-9-1` would hash to a
  // different, equally valid-looking identity for the same occurrence.
  if (!isSyncId(templateSyncId)) {
    throw new Error('A recurring identity needs the template’s canonical sync identity.');
  }
  if (!isLocalDate(occurrenceDate)) {
    throw new Error('A recurring identity needs a canonical YYYY-MM-DD date.');
  }
  return createNameBasedSyncId(
    RECURRING_IDENTITY_NAMESPACE,
    `recurring-occurrence:${templateSyncId}:${occurrenceDate}`,
  );
}

/** `transaction:{occurrenceSyncId}`. */
export function deriveGeneratedTransactionSyncId(occurrenceSyncId: string): string {
  if (!isSyncId(occurrenceSyncId)) {
    throw new Error('A generated transaction identity needs the occurrence’s sync identity.');
  }
  return createNameBasedSyncId(RECURRING_IDENTITY_NAMESPACE, `transaction:${occurrenceSyncId}`);
}
