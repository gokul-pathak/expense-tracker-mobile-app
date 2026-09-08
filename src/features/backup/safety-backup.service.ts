import { createBackup } from './backup.service';
import type { SafetyBackupReason, SafetyBackupStore } from './safety-backup.types';

/**
 * A recovery snapshot taken immediately before a reconciliation that could
 * replace data.
 *
 * The user does not ask for this and never sees a file picker. It exists so
 * that "your data was replaced" is always recoverable, which is what makes the
 * destructive choices in cloud setup safe to offer at all.
 */
export type SafetyBackupResult = { reason: SafetyBackupReason; location: string; createdAt: Date };

export async function createSafetyBackup(
  reason: SafetyBackupReason,
  store?: SafetyBackupStore,
): Promise<SafetyBackupResult> {
  const createdAt = new Date();
  const name = `${reason}-${createdAt.toISOString().replace(/[:.]/g, '-')}.json`;
  // The platform store is resolved on use, not on import: it reaches native file
  // APIs, and nothing that merely references this module should have to load them.
  const target = store ?? (await import('./safety-backup.store')).safetyBackupStore;
  // The same portable format Backup & Restore produces, so a snapshot can be
  // restored through the ordinary restore flow with no special tooling.
  const location = await target.write(name, JSON.stringify(createBackup(), null, 2));
  return { reason, location, createdAt };
}
