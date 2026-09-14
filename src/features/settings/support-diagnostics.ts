import { BACKUP_SCHEMA_VERSION } from '@/features/backup/backup.types';
import { describeSyncStatus } from '@/features/sync/sync-presentation';
import type { CloudSyncStatus } from '@/features/sync/sync-status';

/**
 * What a bug report needs to know about this installation, and nothing else.
 *
 * Four facts: the app version, the database schema the app writes, the platform,
 * and the Cloud Sync state in words. Deliberately no amount, account, category,
 * person, note, email address, identifier or count of records — someone copying
 * this into an email shares how the app is set up, never what it holds.
 */

/** The newest migration this build applies, which is the schema every backup describes. */
export const DATABASE_SCHEMA_VERSION = BACKUP_SCHEMA_VERSION;

export type SupportDiagnosticsInput = {
  appVersion: string;
  platform: string;
  platformVersion: string | number;
  syncStatus: CloudSyncStatus;
};

export type DiagnosticRow = { label: string; value: string };

const PLATFORM_NAMES: Record<string, string> = { android: 'Android', ios: 'iOS', web: 'Web' };

export function buildSupportDiagnostics(input: SupportDiagnosticsInput): DiagnosticRow[] {
  return [
    { label: 'App version', value: input.appVersion },
    { label: 'Database schema', value: DATABASE_SCHEMA_VERSION },
    {
      label: 'Platform',
      value:
        (PLATFORM_NAMES[input.platform] ?? input.platform) + ' ' + String(input.platformVersion),
    },
    { label: 'Cloud Sync', value: describeSyncStatus(input.syncStatus).title },
  ];
}
