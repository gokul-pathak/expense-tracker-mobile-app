import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import { runSeed } from '@/db/seed';
import { assertSyncFoundationReady } from '@/db/sync-integrity';
import * as categoryService from '@/features/categories/category.service';
import * as recurring from '@/features/recurring/recurring.service';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import {
  closeTestDatabase,
  createTestDatabase,
  migrateTestDatabase,
  rawClient,
} from '../support/test-database';

/**
 * The M8C migration, on a device that has been in use since M8B and on a fresh
 * install.
 *
 * What must not happen is the thing a recurring feature is most tempted to do:
 * create transactions. A migration is not a user decision, so it generates
 * nothing, schedules nothing and queues nothing.
 */

const M8B = '20260909120000_budgets';

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

/** Rows written with raw SQL, the way the M8B build would have written them. */
function writeM8bData() {
  const now = Date.now();
  const client = rawClient();
  const account = client
    .prepare(
      'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
    )
    .get(
      'Existing',
      'bank',
      100000,
      'NPR',
      0,
      now,
      now,
      '11111111-1111-4111-8111-111111111111',
    ) as {
    id: number;
  };
  const category = client
    .prepare(
      'INSERT INTO categories (name, type, is_default, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?) RETURNING id',
    )
    .get('Rent', 'expense', 0, now, now, '22222222-2222-4222-8222-222222222222') as { id: number };
  client
    .prepare(
      'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, transaction_date, title, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'expense',
      2000000,
      'NPR',
      category.id,
      account.id,
      now,
      'Rent',
      now,
      now,
      '33333333-3333-4333-8333-333333333333',
    );
  client
    .prepare(
      'INSERT INTO budgets (category_id, period_month, amount_minor, currency, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?)',
    )
    .run(category.id, '2026-09', 2500000, 'NPR', now, now, '44444444-4444-4444-8444-444444444444');
  return { accountId: account.id, categoryId: category.id };
}

function snapshot() {
  return {
    accounts: rawClient().prepare('SELECT * FROM accounts ORDER BY id').all(),
    budgets: rawClient().prepare('SELECT * FROM budgets ORDER BY id').all(),
    transactions: rawClient()
      .prepare(
        'SELECT id, type, amount_minor, currency, category_id, source_account_id, transaction_date, title, sync_id, deleted_at FROM transactions ORDER BY id',
      )
      .all(),
  };
}

describe('the M8C migration', () => {
  afterAll(() => closeTestDatabase());

  it('upgrades an M8B database without inventing a single transaction', async () => {
    createTestDatabase({ through: M8B });
    const ids = writeM8bData();
    const before = snapshot();

    migrateTestDatabase();
    assertSyncFoundationReady();
    await runSeed();

    // Everything that was there is exactly as it was.
    expect(snapshot()).toEqual(before);
    // Nothing recurring exists, nothing was generated, nothing was queued.
    expect(count('recurring_templates')).toBe(0);
    expect(count('recurring_occurrences')).toBe(0);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(0);
    expect(countPendingSyncMutations()).toBe(0);
    expect(verifySyncIntegrity().issues).toEqual([]);

    // And the engine works on top of the upgraded database.
    const template = recurring.createRecurringTemplate({
      type: 'expense',
      amountMinor: 2000000,
      categoryId: ids.categoryId,
      accountId: ids.accountId,
      startDate: '2026-09-01',
      frequency: 'monthly',
    });
    const generated = recurring.generateOccurrence(template.id, '2026-09-01', {
      asOfDate: '2026-09-20',
    });
    expect(transactionService.getTransaction(generated.transactionId!).recurringOccurrenceId).toBe(
      generated.occurrence.id,
    );
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('gives a fresh install the recurring schema, and nothing in it', async () => {
    createTestDatabase();
    await runSeed();

    const tables = rawClient()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'recurring_%'")
      .all()
      .map((row) => String((row as { name: unknown }).name))
      .sort();
    expect(tables).toEqual(['recurring_occurrences', 'recurring_templates']);
    expect(count('recurring_templates')).toBe(0);
    expect(count('recurring_occurrences')).toBe(0);
    // The seed is unchanged and queued nothing, recurring or otherwise.
    expect(categoryService.listExpenseCategories().length).toBeGreaterThan(0);
    expect(countPendingSyncMutations()).toBe(0);
    const report = verifySyncIntegrity();
    expect(report.issues).toEqual([]);
    expect(report.counts.recurringTemplates).toBe(0);
    expect(report.counts.recurringOccurrences).toBe(0);
  });

  it('enforces one decision per date and one transaction per occurrence in SQLite itself', async () => {
    createTestDatabase();
    await runSeed();
    const now = Date.now();
    const client = rawClient();
    const category = categoryService.listExpenseCategories()[0]!;
    const account = client
      .prepare(
        'INSERT INTO accounts (name, type, opening_balance_minor, currency, is_archived, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      )
      .get('Cash', 'cash', 0, 'NPR', 0, now, now, '55555555-5555-4555-8555-555555555555') as {
      id: number;
    };
    const template = client
      .prepare(
        'INSERT INTO recurring_templates (type, amount_minor, currency, category_id, account_id, title, start_date, frequency, interval_count, is_paused, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
      )
      .get(
        'expense',
        100,
        'NPR',
        category.id,
        account.id,
        '',
        '2026-09-01',
        'monthly',
        1,
        0,
        now,
        now,
        '66666666-6666-4666-8666-666666666666',
      ) as {
      id: number;
    };
    const insertOccurrence = client.prepare(
      'INSERT INTO recurring_occurrences (template_id, occurrence_date, status, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?) RETURNING id',
    );
    const occurrence = insertOccurrence.get(
      template.id,
      '2026-09-01',
      'generated',
      now,
      now,
      '77777777-7777-5777-8777-777777777777',
    ) as {
      id: number;
    };

    expect(() =>
      insertOccurrence.run(
        template.id,
        '2026-09-01',
        'skipped',
        now,
        now,
        '88888888-8888-5888-8888-888888888888',
      ),
    ).toThrow(/UNIQUE/);

    const insertTransaction = client.prepare(
      'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, transaction_date, title, created_at, updated_at, sync_id, recurring_occurrence_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    );
    insertTransaction.run(
      'expense',
      100,
      'NPR',
      category.id,
      account.id,
      now,
      '',
      now,
      now,
      '99999999-9999-5999-8999-999999999999',
      occurrence.id,
    );
    expect(() =>
      insertTransaction.run(
        'expense',
        100,
        'NPR',
        category.id,
        account.id,
        now,
        '',
        now,
        now,
        'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa',
        occurrence.id,
      ),
    ).toThrow(/UNIQUE/);
    // Hand-entered transactions share a null link freely.
    insertTransaction.run(
      'expense',
      100,
      'NPR',
      category.id,
      account.id,
      now,
      '',
      now,
      now,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      null,
    );
    insertTransaction.run(
      'expense',
      100,
      'NPR',
      category.id,
      account.id,
      now,
      '',
      now,
      now,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      null,
    );
  });
});
