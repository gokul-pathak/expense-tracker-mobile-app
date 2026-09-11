import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import { deriveOccurrenceSyncId } from '@/features/recurring/recurring-identity';
import { listOccurrenceDates } from '@/features/recurring/recurring-schedule';
import * as recurring from '@/features/recurring/recurring.service';

import { setupDatabase } from '../support/domain';
import { closeTestDatabase, rawClient } from '../support/test-database';

import { buildRecurringFixture } from './fixture';

/**
 * A person with a hundred recurring templates, years of decisions and five
 * thousand transactions.
 *
 * The assertion that matters is not the clock — a threshold here says nothing
 * about a phone. It is that working out what is due never reads the transactions
 * table. What is due is the schedule minus the occurrences table, so its cost
 * grows with templates and decisions, never with years of spending.
 */

const TEMPLATES = 100;
const TRANSACTIONS = 5_000;
const HANDLED_THROUGH = '2026-08-31';
const AS_OF = '2026-09-20';

let occurrencesWritten = 0;

/** Written straight to SQLite: going through the services would measure the services. */
function buildHistory() {
  const fixture = buildRecurringFixture();
  const client = rawClient();
  const now = Date.now();

  client.exec('BEGIN');
  const insertTemplate = client.prepare(
    'INSERT INTO recurring_templates (type, amount_minor, currency, category_id, account_id, title, start_date, frequency, interval_count, is_paused, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
  );
  const insertOccurrence = client.prepare(
    'INSERT INTO recurring_occurrences (template_id, occurrence_date, status, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?)',
  );

  for (let index = 0; index < TEMPLATES; index += 1) {
    // Half monthly on the 1st, half weekly on Mondays, all started in 2023.
    const monthly = index % 2 === 0;
    const schedule = {
      startDate: monthly ? '2023-01-01' : '2023-01-02',
      frequency: monthly ? ('monthly' as const) : ('weekly' as const),
      interval: 1,
      endDate: null,
    };
    const syncId = randomUUID();
    const row = insertTemplate.get(
      'expense',
      100,
      'NPR',
      fixture.food.id,
      fixture.bank.id,
      `Template ${index}`,
      schedule.startDate,
      schedule.frequency,
      1,
      0,
      now,
      now,
      syncId,
    ) as { id: number };

    // Every date up to the end of August is decided; September is outstanding.
    for (const date of listOccurrenceDates(schedule, { to: HANDLED_THROUGH, limit: 10_000 })
      .dates) {
      insertOccurrence.run(row.id, date, 'skipped', now, now, deriveOccurrenceSyncId(syncId, date));
      occurrencesWritten += 1;
    }
  }

  const insertTransaction = client.prepare(
    'INSERT INTO transactions (type, amount_minor, currency, category_id, source_account_id, payment_mode, transaction_date, title, created_at, updated_at, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (let index = 0; index < TRANSACTIONS; index += 1) {
    insertTransaction.run(
      'expense',
      100,
      'NPR',
      fixture.food.id,
      fixture.bank.id,
      'cash',
      new Date(2026, index % 12, (index % 27) + 1).getTime(),
      `Expense ${index}`,
      now,
      now,
      randomUUID(),
    );
  }
  client.exec('COMMIT');
}

/** Every SQL statement a call prepares, so a test can say which tables it read. */
function captureStatements<T>(run: () => T): { result: T; statements: string[] } {
  const client = rawClient() as unknown as { prepare: (sql: string) => unknown };
  const original = client.prepare.bind(client);
  const statements: string[] = [];
  client.prepare = (sql: string) => {
    statements.push(sql);
    return original(sql);
  };
  try {
    return { result: run(), statements };
  } finally {
    client.prepare = original;
  }
}

describe('a hundred templates with years of history', () => {
  beforeAll(async () => {
    await setupDatabase();
    buildHistory();
  }, 120_000);
  afterAll(() => closeTestDatabase());

  it('works out what is due without reading a single transaction', () => {
    const started = Date.now();
    const { result, statements } = captureStatements(() =>
      recurring.listDueOccurrences({ asOfDate: AS_OF }),
    );
    const elapsed = Date.now() - started;

    // 50 monthly templates due on Sep 1, 50 weekly due on Sep 7 and Sep 14.
    expect(result.hasMore).toBe(true);
    expect(result.occurrences).toHaveLength(100);
    expect(
      result.occurrences.slice(0, 50).every((item) => item.occurrenceDate === '2026-09-01'),
    ).toBe(true);
    expect(result.occurrences.slice(50).every((item) => item.occurrenceDate === '2026-09-07')).toBe(
      true,
    );

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.some((sql) => /\btransactions\b/.test(sql))).toBe(false);
    // A smoke test for the wrong shape of work, not a benchmark.
    expect(elapsed).toBeLessThan(3_000);
    console.log(
      `recurring due: ${TEMPLATES} templates, ${occurrencesWritten} handled dates, ` +
        `${TRANSACTIONS} transactions -> ${elapsed}ms, ${statements.length} statements`,
    );
  }, 60_000);

  it('lists every template with its next due date from one read of the history', () => {
    const { result, statements } = captureStatements(() => recurring.listRecurringTemplates());

    expect(result).toHaveLength(TEMPLATES);
    expect(result.every((template) => template.nextDueDate?.startsWith('2026-09') === true)).toBe(
      true,
    );
    expect(statements.some((sql) => /\btransactions\b/.test(sql))).toBe(false);
  }, 60_000);
});
