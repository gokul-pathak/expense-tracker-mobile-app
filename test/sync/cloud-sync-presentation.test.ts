import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  describeLastSync,
  describePendingChanges,
  describeReconciliationFailure,
  describeSyncError,
  describeSyncStatus,
  describeUseCloudData,
  describeUseLocalData,
  SETUP_STEPS,
} from '@/features/sync/sync-presentation';
import { CLOUD_SYNC_STATUSES } from '@/features/sync/sync-status';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(path: string) {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('cloud sync wording', () => {
  it('has copy for every status it can be in', () => {
    for (const status of CLOUD_SYNC_STATUSES) {
      const copy = describeSyncStatus(status);
      expect(copy.title.length, status).toBeGreaterThan(0);
      expect(copy.description.length, status).toBeGreaterThan(0);
    }
  });

  it('does not tell a local-only user their data is unsafe', () => {
    const copy = describeSyncStatus('local_only');

    expect(copy.description).toBe('Your financial data is currently stored on this device.');
    expect(copy.description.toLowerCase()).not.toMatch(/unsafe|at risk|lose|warning/);
  });

  it('says only what is true once a device is linked', () => {
    // A linked device does not keep data only on this device any more.
    const screen = read('src/app/cloud-sync/index.tsx');
    expect(screen).toMatch(/synchronized with your cloud account/i);
    expect(screen).not.toMatch(/stays only on this device/i);
  });

  it('counts pending changes in plain language', () => {
    expect(describePendingChanges(0, false)).toBeNull();
    expect(describePendingChanges(1, false)).toBe('1 change waiting to upload');
    expect(describePendingChanges(3, false)).toBe('3 changes waiting to upload');
    expect(describePendingChanges(3, true)).toBe("3 changes will sync when you're online");
  });

  it('never shows a technical code to a person', () => {
    const codes = [
      'network',
      'auth',
      'authorization',
      'account_mismatch',
      'invalid_remote_data',
      'domain_invariant',
      'invalid_local_data',
      'PGRST116',
      '42501',
      'JWT expired',
    ];
    for (const code of codes) {
      const message = describeSyncError(code);
      expect(message, code).not.toBeNull();
      expect(message!, code).not.toContain(code === 'network' ? 'zzz' : code);
      expect(message!, code).toMatch(/[a-z]/);
    }
    expect(describeSyncError(null)).toBeNull();
  });

  it('names the consequence of each first-link choice instead of saying continue', () => {
    const uploadOnly = describeUseLocalData(false);
    expect(uploadOnly.body).toContain('uploaded to your cloud account');
    expect(uploadOnly.warning).toBeUndefined();

    const replaceCloud = describeUseLocalData(true);
    expect(replaceCloud.body).toBe(
      'Your cloud financial data will be replaced by the data currently on this device.',
    );
    expect(replaceCloud.warning).toBeDefined();
    expect(replaceCloud.confirmLabel.toLowerCase()).not.toBe('continue');

    const restore = describeUseCloudData(false);
    expect(restore.title).toBe('Restore From Cloud');
    expect(restore.warning).toBeUndefined();

    const replaceLocal = describeUseCloudData(true);
    expect(replaceLocal.body).toBe(
      'The financial data currently on this device will be replaced by your cloud data.',
    );
    expect(replaceLocal.warning).toBeDefined();
    expect(replaceLocal.confirmLabel.toLowerCase()).not.toBe('continue');
  });

  it('promises unchanged data only where that is guaranteed', () => {
    expect(describeReconciliationFailure('network')).toContain('try again');
    expect(describeReconciliationFailure('invalid_cloud_data')).toContain(
      'Nothing on this device was changed',
    );
    expect(describeReconciliationFailure('backup_failed')).toContain('Your data is unchanged');
    expect(describeReconciliationFailure('account_mismatch')).toContain('different cloud account');
  });

  it('describes setup progress without inventing a percentage', () => {
    for (const step of Object.values(SETUP_STEPS)) {
      expect(step).toMatch(/…$/);
      expect(step).not.toMatch(/\d+\s*%/);
    }
    expect(read('src/app/cloud-sync/setup.tsx')).not.toMatch(/\d+\s*%/);
  });

  it('shows an absolute time for the last successful sync', () => {
    expect(describeLastSync(null)).toBe('Never');
    expect(describeLastSync(new Date(2026, 0, 15, 9, 30))).toContain('2026');
  });
});

describe('cloud sync screen boundaries', () => {
  const screens = [
    'src/app/cloud-sync/index.tsx',
    'src/app/cloud-sync/setup.tsx',
    'src/features/sync/sync.provider.tsx',
  ];

  it('keeps Supabase out of the screens', () => {
    for (const path of screens) {
      const source = read(path);
      expect(source, path).not.toMatch(/@supabase|\.from\(|\.schema\(|PostgREST/);
    }
  });

  it('adds no realtime and no OS background scheduling', () => {
    const syncPaths = [
      ...screens,
      'src/features/sync/sync.service.ts',
      'src/features/sync/reconciliation.service.ts',
      'src/features/sync/initial-upload.service.ts',
      'src/features/sync/cloud-snapshot.service.ts',
    ];
    for (const path of syncPaths) {
      const source = read(path);
      expect(source, path).not.toMatch(/realtime|channel\(|subscribe\(/i);
      expect(source, path).not.toMatch(/BackgroundFetch|TaskManager|expo-background|registerTask/);
    }
  });

  it('throttles automatic foreground syncing rather than polling', () => {
    const provider = read('src/features/sync/sync.provider.tsx');
    expect(provider).toMatch(/FOREGROUND_SYNC_INTERVAL_MS/);
    expect(provider).not.toMatch(/setInterval/);
  });

  it('keeps financial screens reading local data only', () => {
    const home = read('src/app/(tabs)/index.tsx');
    // The one sync import a financial screen may have is the refresh nudge.
    expect(home).toMatch(/use-synced-data/);
    expect(home).not.toMatch(/pullRemoteChanges|pushPendingChanges|syncNow|supabase/i);
  });

  it('does not add a second local dataset for another account', () => {
    const schema = read('src/db/schema/sync.ts');
    expect(schema).not.toMatch(/profiles|accountsByUser|multi_user/i);
    expect(schema).toMatch(/linked_user_id/);
  });
});
