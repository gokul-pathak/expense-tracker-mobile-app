import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SYNC_ENTITY_TYPES } from '@/db/schema/sync.constants';

/**
 * Source-level guarantees for the AI boundary.
 *
 * Behavioural tests prove an AI suggestion changed nothing on the paths they
 * run. These prove the capability is absent: the AI feature cannot create or
 * edit a transaction because it never references anything that could, the app
 * cannot hold a provider secret because none is named anywhere in it, and the
 * function cannot log a receipt because only one line in it logs at all.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const aiFeature = join(root, 'src/features/ai');
const functions = join(root, 'supabase/functions');

function* walk(directory: string, extensions = ['.ts', '.tsx']): Generator<string> {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path, extensions);
    } else if (extensions.some((extension) => path.endsWith(extension))) {
      yield path;
    }
  }
}

const name = (path: string) => relative(root, path).split(sep).join('/');
const source = (path: string) => readFileSync(path, 'utf8');

describe('the AI feature in the app', () => {
  it('references no way to create, change or delete money', () => {
    const forbidden = [
      'createExpense',
      'createIncome',
      'createTransfer',
      'createLend',
      'createBorrow',
      'createRepayment',
      'updateExpense',
      'updateIncome',
      'updateTransaction',
      'deleteTransaction',
      'transaction.service',
      'saveReceiptExpense',
      'enqueueSyncMutation',
      'repository',
      "from '@/db'",
      "'@/db/schema",
      '@/features/ui/data',
      'createBudget',
      'recurring.service',
      'generateOccurrence',
      'skipOccurrence',
    ];
    const offenders: string[] = [];
    for (const file of walk(aiFeature)) {
      const text = source(file);
      for (const word of forbidden)
        if (text.includes(word)) offenders.push(`${name(file)}: ${word}`);
    }
    expect(offenders).toEqual([]);
  });

  it('has no access to receipt images, balances, people or history', () => {
    const offenders: string[] = [];
    for (const file of walk(aiFeature)) {
      const text = source(file);
      for (const word of [
        'expo-image-picker',
        'receipt-files',
        'imageUri',
        'getAccountBalance',
        'getDashboardSummary',
        'getReportSummary',
        'listTransaction',
        'person.service',
        '@/features/backup',
      ]) {
        if (text.includes(word)) offenders.push(`${name(file)}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('makes network calls only from its two providers, through the project’s own functions', () => {
    const callers = [...walk(aiFeature)].filter((file) => {
      const text = source(file);
      return text.includes('functions.invoke') || text.includes('@supabase/supabase-js');
    });
    expect(callers.map(name).sort()).toEqual([
      'src/features/ai/insights/supabase-financial-insight.provider.ts',
      'src/features/ai/supabase-expense-suggestion.provider.ts',
    ]);
    for (const file of walk(aiFeature)) expect(source(file)).not.toContain('fetch(');
  });

  it('logs nothing', () => {
    const offenders = [...walk(aiFeature)].filter((file) =>
      /console\.(log|warn|error|info|debug)/.test(source(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('secrets', () => {
  const clientFiles = [
    ...walk(join(root, 'src'), ['.ts', '.tsx', '.js', '.json']),
    join(root, 'app.json'),
    join(root, '.env.example'),
    join(root, 'package.json'),
  ].filter(existsSync);

  it('are never named in the app, its config or its public environment', () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const text = source(file);
      for (const pattern of [
        /sk-ant-/,
        /ANTHROPIC_API_KEY/,
        /OPENAI/i,
        /service_role/i,
        /SERVICE_ROLE/,
        /SECRET_KEYS?/,
        /EXPO_PUBLIC_[A-Z_]*(AI|ANTHROPIC|LLM|MODEL)/,
      ]) {
        if (pattern.test(text)) offenders.push(`${name(file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the provider SDK out of the app bundle', () => {
    const manifest = JSON.parse(source(join(root, 'package.json'))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.dependencies).not.toHaveProperty('@anthropic-ai/sdk');
    for (const file of walk(join(root, 'src'))) {
      expect(source(file)).not.toContain('@anthropic-ai/sdk');
    }
  });

  it('keeps function secrets out of Git', () => {
    const ignore = source(join(root, '.gitignore')).split(/\r?\n/);
    expect(ignore).toContain('.env');
    expect(ignore).toContain('.env.*');
    expect(ignore).toContain('!.env.example');
    const example = source(join(functions, '.env.example'));
    expect(example).toMatch(/^ANTHROPIC_API_KEY=$/m);
  });

  it('needs no service-role or secret key in the function either', () => {
    for (const file of walk(functions)) {
      const text = source(file);
      expect(text, name(file)).not.toMatch(/SERVICE_ROLE|service_role|SUPABASE_SECRET_KEYS/);
    }
  });
});

describe('the suggestion function', () => {
  it('logs from one place, and that place is handed metadata only', () => {
    const loggers = [...walk(functions)].filter((file) => /console\./.test(source(file)));
    expect(loggers.map(name).sort()).toEqual([
      'supabase/functions/explain-financial-insight/index.ts',
      'supabase/functions/suggest-expense-category/index.ts',
    ]);
    const index = source(join(functions, 'suggest-expense-category/index.ts'));
    expect(index.match(/console\./g)).toHaveLength(1);
    expect(index).toContain('function log(event: SuggestionLogEvent)');
    const insight = source(join(functions, 'explain-financial-insight/index.ts'));
    expect(insight.match(/console\./g)).toHaveLength(1);
    expect(insight).toContain('function log(event: InsightLogEvent)');
  });

  it('gives the model no tools, no database and no way to ask for more', () => {
    const providers = [
      source(join(functions, '_shared/expense-suggestion/anthropic-provider.ts')),
      source(join(functions, '_shared/financial-insight/anthropic-insight-provider.ts')),
    ];
    // Request parameters, not words in comments.
    for (const provider of providers) {
      for (const parameter of [
        /\btools\s*:/,
        /\btool_choice\s*:/,
        /\bmcp_servers\s*:/,
        /\bcontainer\s*:/,
        /type:\s*'(image|document)'/,
      ]) {
        expect(provider).not.toMatch(parameter);
      }
    }
    // The insight function has no database access of its own at all.
    const insight = [...walk(join(functions, '_shared/financial-insight'))].map(source).join('\n');
    expect(insight).not.toMatch(/\.rpc\(|\.from\(|\.sql|execute\(|createClient/);
    const shared = [...walk(join(functions, '_shared/expense-suggestion'))].map(source).join('\n');
    // The only database call is the caller's own quota.
    expect(shared.match(/\.rpc\(/g)).toHaveLength(1);
    expect(shared).not.toMatch(/\.from\(|\.sql|execute\(/);
  });
});

describe('storage and sync', () => {
  it('adds no sync entity for AI', () => {
    expect(SYNC_ENTITY_TYPES.some((type) => /ai|suggest|prompt/.test(type))).toBe(false);
  });

  it('stores counts in the cloud and nothing a receipt or a model said', () => {
    const migrations = join(root, 'supabase/migrations');
    const quota = readdirSync(migrations).find((file) => file.includes('ai_suggestion'));
    expect(quota).toBeDefined();
    const sql = source(join(migrations, quota!));
    const table =
      /create table ai_private\.suggestion_usage \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    const columns = table
      .split('\n')
      .map((line) => /^\s*([a-z_]+)\s+(uuid|text|timestamptz|integer)\b/.exec(line)?.[1])
      .filter((column): column is string => column !== undefined);
    // Who, which window, and how many. No column could hold what was asked or answered.
    expect(columns).toEqual(['user_id', 'window_kind', 'window_start', 'request_count']);
    expect(sql).not.toMatch(/sync\./);
  });

  it('keeps the AI preference out of the synced settings and the backup', () => {
    const settings = source(join(root, 'src/features/settings/settings.repository.ts'));
    const backup = source(join(root, 'src/features/backup/backup.service.ts'));
    for (const text of [settings, backup]) {
      expect(text).not.toMatch(/features\/ai|suggestion/i);
    }
  });
});
