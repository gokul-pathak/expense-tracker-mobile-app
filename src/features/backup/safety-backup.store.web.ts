import type { SafetyBackupStore } from './safety-backup.types';

/**
 * Local financial data only exists in the Android/iOS app, so there is nothing
 * on web for a safety backup to protect and no reconciliation to protect it
 * from. Failing loudly is better than pretending a snapshot was written.
 */
export const safetyBackupStore: SafetyBackupStore = {
  async write() {
    throw new Error('Safety backups are available in the Android/iOS app.');
  },
};
