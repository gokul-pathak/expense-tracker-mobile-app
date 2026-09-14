import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildSupportDiagnostics,
  DATABASE_SCHEMA_VERSION,
} from '@/features/settings/support-diagnostics';
import { describeSyncStatus } from '@/features/sync/sync-presentation';

/**
 * Settings → About: what a bug report needs, and nothing a person would not want
 * to paste into an email.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('support diagnostics', () => {
  it('names the schema of the newest migration this build applies', () => {
    const migrations = readdirSync(join(root, 'drizzle'))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    expect(DATABASE_SCHEMA_VERSION).toBe(migrations[migrations.length - 1]);
  });

  it('holds the app version, schema, platform and sync state, in that order', () => {
    const rows = buildSupportDiagnostics({
      appVersion: '0.1.0',
      platform: 'android',
      platformVersion: 34,
      syncStatus: 'pending_changes',
    });
    expect(rows).toEqual([
      { label: 'App version', value: '0.1.0' },
      { label: 'Database schema', value: DATABASE_SCHEMA_VERSION },
      { label: 'Platform', value: 'Android 34' },
      { label: 'Cloud Sync', value: describeSyncStatus('pending_changes').title },
    ]);
  });

  it('reads nothing from a financial record, the database or an account', () => {
    const source = ['support-diagnostics.ts', 'SupportDiagnostics.tsx']
      .map((file) => readFileSync(join(root, 'src/features/settings', file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /from '@\/(db|features\/(transactions|accounts|people|investments|budgets|recurring|receipts|cloud-auth|ui\/data))/,
    );
  });
});
