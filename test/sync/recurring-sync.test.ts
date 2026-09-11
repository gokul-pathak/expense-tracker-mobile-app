import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));

import * as accountService from '@/features/accounts/account.service';
import {
  deriveGeneratedTransactionSyncId,
  deriveOccurrenceSyncId,
} from '@/features/recurring/recurring-identity';
import * as recurring from '@/features/recurring/recurring.service';
import { readLocalDataInventory, summarizeCloudInventory } from '@/features/sync/data-inventory';
import { verifySyncIntegrity } from '@/features/sync/dev/verify-sync-integrity';
import { pullRemoteChanges } from '@/features/sync/pull-sync.service';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import {
  linkUsingCloudData,
  linkUsingLocalData,
  type ReconciliationOptions,
} from '@/features/sync/reconciliation.service';
import { deriveCloudSyncStatus } from '@/features/sync/sync-status';
import { countPendingSyncMutations } from '@/features/sync/sync.repository';
import { getAccountBalance } from '@/features/transactions/account-balance.service';

import {
  cloudRecurringOccurrence,
  cloudRecurringTemplate,
  cloudSyncId,
  cloudTransaction,
  TEST_USER,
} from '../support/cloud-rows';
import { onDevice, setupDatabase, setupDevice } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase, rawClient } from '../support/test-database';

import {
  buildRecurringFixture,
  createGroceryRun,
  rupees,
  type RecurringFixture,
} from '../recurring/fixture';

/**
 * Recurring transactions across devices.
 *
 * The release-critical property: two phones, both offline, both generate the
 * rent for September 1. After they sync there is one rent payment, not two.
 * Nothing in the engine coordinates them — they cannot talk to each other — so
 * the guarantee comes from both deriving the same identities, and the cloud's
 * identity-keyed upsert doing the rest.
 *
 * Every test runs two genuinely separate SQLite databases against one in-memory
 * cloud that reproduces the real one's behaviour, including the trigger that
 * keeps a generated occurrence from being turned back into a skipped one.
 */

const A = 'default';
const B = 'B';
const AS_OF = '2026-09-20';

let cloud: FakeCloud;
let fixture: RecurringFixture;

function push() {
  return pushPendingChanges({
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
    },
  });
}

function pull() {
  return pullRemoteChanges({
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.pullRepository,
    },
  });
}

function reconcile(): ReconciliationOptions {
  return {
    dependencies: {
      getAuthenticatedUserId: async () => TEST_USER,
      createRemote: () => cloud.repository,
      createPullRemote: () => cloud.pullRepository,
      createSnapshotRemote: () => cloud.snapshotRepository,
      createSafetyBackup: async (reason) => ({
        reason,
        location: `memory://${reason}`,
        createdAt: new Date(),
      }),
      reseedDefaults: async () => false,
    },
  };
}

function count(table: string, where = '1 = 1'): number {
  const row = rawClient().prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get();
  return Number((row as { total: number }).total);
}

/** This device's local copy of a template, found by the identity every device shares. */
function localTemplate(syncId: string) {
  const template = recurring.listRecurringTemplates().find((item) => item.syncId === syncId);
  if (template === undefined) throw new Error('This device does not have that template.');
  return template;
}

function localAccountBalance(syncId: string) {
  const account = accountService.listAccounts().find((item) => item.syncId === syncId);
  if (account === undefined) throw new Error('This device does not have that account.');
  return getAccountBalance(account.id);
}

function occurrenceStatus(syncId: string) {
  const row = rawClient()
    .prepare('SELECT status, deleted_at FROM recurring_occurrences WHERE sync_id = ?')
    .get(syncId) as { status: string; deleted_at: number | null } | undefined;
  return row === undefined ? null : row.deleted_at === null ? row.status : 'deleted';
}

function transactionsFor(occurrenceSyncId: string) {
  return count(
    'transactions',
    `deleted_at IS NULL AND recurring_occurrence_id = (SELECT id FROM recurring_occurrences WHERE sync_id = '${occurrenceSyncId}')`,
  );
}

describe('recurring upload', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('uploads a template as a plan, its relations as identities, and nothing derived', async () => {
    const template = createGroceryRun(fixture);

    expect((await push()).status).toBe('success');

    const row = cloud.rowBySyncId('recurring_template', template.syncId!) as unknown as Record<
      string,
      unknown
    >;
    expect(row).toEqual({
      sync_id: template.syncId,
      user_id: TEST_USER,
      type: 'expense',
      amount_minor: rupees(5_000),
      currency: 'NPR',
      category_sync_id: fixture.food.syncId,
      account_sync_id: fixture.bank.syncId,
      payment_mode: null,
      title: 'Food box',
      note: null,
      start_date: '2026-06-15',
      frequency: 'monthly',
      interval_count: 1,
      end_date: null,
      is_paused: false,
      created_at: template.createdAt.getTime(),
      updated_at: template.updatedAt.getTime(),
      deleted_at: null,
    });
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('uploads the template, then the occurrence, then the transaction that points at it', async () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    expect((await push()).status).toBe('success');

    const order = cloud.calls.map((call) => call.entityType);
    expect(order.indexOf('recurring_template')).toBeLessThan(order.indexOf('recurring_occurrence'));
    expect(order.indexOf('recurring_occurrence')).toBeLessThan(order.indexOf('transaction'));

    const occurrenceSyncId = generated.occurrence.syncId!;
    expect(cloud.rowBySyncId('recurring_occurrence', occurrenceSyncId)).toMatchObject({
      template_sync_id: template.syncId,
      occurrence_date: '2026-06-15',
      status: 'generated',
    });
    expect(
      cloud.rowBySyncId('transaction', deriveGeneratedTransactionSyncId(occurrenceSyncId)),
    ).toMatchObject({ recurring_occurrence_sync_id: occurrenceSyncId, type: 'expense' });
  });

  it('counts pending recurring work as ordinary unsynchronized changes', async () => {
    // The fixture's accounts are already queued; count only what this adds.
    const before = countPendingSyncMutations();
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    // The template, the occurrence and its transaction: three ordinary queue
    // entries feeding the one global status, not a recurring-specific one.
    expect(countPendingSyncMutations() - before).toBe(3);
    expect(
      deriveCloudSyncStatus({
        configured: true,
        authenticatedUserId: TEST_USER,
        linkedUserId: TEST_USER,
        linking: false,
        reconciliationRequired: false,
        syncing: false,
        pendingChanges: countPendingSyncMutations(),
        attentionRequired: 0,
        lastError: null,
        offline: false,
      }),
    ).toBe('pending_changes');

    await push();
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('uploads a template created, used and deleted between two pushes', async () => {
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.deleteRecurringTemplate(template.id);

    // The tombstone is the only upload that ever tells the cloud this template
    // existed, and the occurrence needs it there first.
    const result = await push();

    expect(result.status).toBe('success');
    expect(result.failures).toEqual([]);
    expect(
      (cloud.rowBySyncId('recurring_template', template.syncId!) as { deleted_at: number | null })
        .deleted_at,
    ).not.toBeNull();
    expect(cloud.rowBySyncId('recurring_occurrence', generated.occurrence.syncId!)).toBeDefined();
    expect(countPendingSyncMutations()).toBe(0);
  });
});

describe('recurring download', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    fixture = buildRecurringFixture();
    await push();
  });
  afterAll(() => closeTestDatabase());

  function remoteRent(overrides: Parameters<typeof cloudRecurringTemplate>[0] | object = {}) {
    return cloudRecurringTemplate({
      category_sync_id: fixture.bills.syncId!,
      account_sync_id: fixture.bank.syncId!,
      start_date: '2026-08-01',
      ...overrides,
    });
  }

  it('applies a remote template, occurrence and transaction without queueing them back', async () => {
    const template = remoteRent();
    const occurrence = cloudRecurringOccurrence({
      template_sync_id: template.sync_id,
      occurrence_date: '2026-08-01',
    });
    cloud.putRow('recurring_template', template);
    cloud.putRow('recurring_occurrence', occurrence);
    cloud.putRow(
      'transaction',
      cloudTransaction({
        sync_id: deriveGeneratedTransactionSyncId(occurrence.sync_id),
        type: 'expense',
        amount_minor: rupees(20_000),
        category_sync_id: fixture.bills.syncId!,
        source_account_sync_id: fixture.bank.syncId!,
        transaction_date: new Date(2026, 7, 1, 12).getTime(),
        title: 'Rent',
        recurring_occurrence_sync_id: occurrence.sync_id,
      }),
    );

    const result = await pull();

    expect(result.status).toBe('success');
    const local = localTemplate(template.sync_id);
    expect(local).toMatchObject({
      categoryId: fixture.bills.id,
      accountId: fixture.bank.id,
      startDate: '2026-08-01',
    });
    expect(occurrenceStatus(occurrence.sync_id)).toBe('generated');
    expect(transactionsFor(occurrence.sync_id)).toBe(1);
    expect(countPendingSyncMutations()).toBe(0);
    // August is handled; September is due, derived here from what was downloaded.
    expect(
      recurring
        .listDueOccurrences({ asOfDate: AS_OF })
        .occurrences.map((item) => item.occurrenceDate),
    ).toEqual(['2026-09-01']);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('refuses an occurrence whose identity is not derived from its template and date', async () => {
    const template = remoteRent();
    cloud.putRow('recurring_template', template);
    cloud.putRow(
      'recurring_occurrence',
      cloudRecurringOccurrence({
        sync_id: cloudSyncId(),
        template_sync_id: template.sync_id,
        occurrence_date: '2026-08-01',
      }),
    );

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({
      entityType: 'recurring_occurrence',
      detail: 'occurrence_identity',
    });
    expect(count('recurring_occurrences')).toBe(0);
  });

  it('refuses a generated transaction that claims an occurrence under another identity', async () => {
    const template = remoteRent();
    const occurrence = cloudRecurringOccurrence({
      template_sync_id: template.sync_id,
      occurrence_date: '2026-08-01',
    });
    cloud.putRow('recurring_template', template);
    cloud.putRow('recurring_occurrence', occurrence);
    cloud.putRow(
      'transaction',
      cloudTransaction({
        type: 'expense',
        category_sync_id: fixture.bills.syncId!,
        source_account_sync_id: fixture.bank.syncId!,
        recurring_occurrence_sync_id: occurrence.sync_id,
      }),
    );

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({
      entityType: 'transaction',
      detail: 'recurring_transaction_identity',
    });
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(0);
  });

  it('refuses a template whose category is of the other type', async () => {
    cloud.putRow('recurring_template', remoteRent({ category_sync_id: fixture.salary.syncId! }));

    const result = await pull();

    expect(result.status).toBe('attention_required');
    expect(result.failures[0]).toMatchObject({
      entityType: 'recurring_template',
      detail: 'category_type',
    });
    expect(count('recurring_templates')).toBe(0);
  });
});

describe('two devices and one recurring occurrence', () => {
  let template: { id: number; syncId: string | null };

  beforeEach(async () => {
    cloud = createFakeCloud();
    // A links first and publishes its whole dataset; B then restores from the
    // cloud, which is how a second device really joins.
    await setupDatabase();
    await linkUsingLocalData(reconcile());
    await setupDevice(B);
    await linkUsingCloudData(reconcile());

    onDevice(A);
    fixture = buildRecurringFixture();
    template = createGroceryRun(fixture, { startDate: '2026-09-01', title: 'Rent' });
    await push();
    onDevice(B);
    await pull();
    onDevice(A);
  });
  afterAll(() => closeTestDatabase());

  it('converges two offline generations of the same date on one occurrence and one transaction', async () => {
    onDevice(A);
    const onA = recurring.generateOccurrence(template.id, '2026-09-01', { asOfDate: AS_OF });
    onDevice(B);
    const onB = recurring.generateOccurrence(localTemplate(template.syncId!).id, '2026-09-01', {
      asOfDate: AS_OF,
    });

    // Neither device asked the other anything, and they still agree.
    expect(onB.occurrence.syncId).toBe(onA.occurrence.syncId);
    const occurrenceSyncId = onA.occurrence.syncId!;

    onDevice(A);
    expect((await push()).status).toBe('success');
    onDevice(B);
    expect((await push()).status).toBe('success');
    onDevice(A);
    await pull();
    onDevice(B);
    await pull();

    expect(cloud.rows('recurring_occurrence')).toHaveLength(1);
    expect(
      cloud
        .rows('transaction')
        .filter(
          (row) =>
            (row as { recurring_occurrence_sync_id: string | null })
              .recurring_occurrence_sync_id === occurrenceSyncId,
        ),
    ).toHaveLength(1);

    const balances: number[] = [];
    for (const device of [A, B]) {
      onDevice(device);
      expect(transactionsFor(occurrenceSyncId)).toBe(1);
      expect(count('recurring_occurrences', 'deleted_at IS NULL')).toBe(1);
      expect(countPendingSyncMutations()).toBe(0);
      expect(verifySyncIntegrity().issues).toEqual([]);
      balances.push(localAccountBalance(fixture.bank.syncId!));
    }
    // One rent payment on both devices, not one each.
    expect(balances).toEqual([rupees(1_000_000 - 5_000), rupees(1_000_000 - 5_000)]);
  });

  it('lets a generated date beat a skip when the generation uploads first', async () => {
    onDevice(A);
    const generated = recurring.generateOccurrence(template.id, '2026-09-01', { asOfDate: AS_OF });
    onDevice(B);
    recurring.skipOccurrence(localTemplate(template.syncId!).id, '2026-09-01', { asOfDate: AS_OF });

    onDevice(A);
    await push();
    onDevice(B);
    await push();
    onDevice(A);
    await pull();
    onDevice(B);
    await pull();

    const occurrenceSyncId = generated.occurrence.syncId!;
    expect(
      (cloud.rowBySyncId('recurring_occurrence', occurrenceSyncId) as { status: string }).status,
    ).toBe('generated');
    for (const device of [A, B]) {
      onDevice(device);
      expect(occurrenceStatus(occurrenceSyncId)).toBe('generated');
      expect(transactionsFor(occurrenceSyncId)).toBe(1);
    }
  });

  it('lets a generated date beat a skip when the skip uploads first', async () => {
    onDevice(B);
    const skipped = recurring.skipOccurrence(localTemplate(template.syncId!).id, '2026-09-01', {
      asOfDate: AS_OF,
    });
    onDevice(A);
    recurring.generateOccurrence(template.id, '2026-09-01', { asOfDate: AS_OF });

    onDevice(B);
    await push();
    onDevice(A);
    await push();
    onDevice(A);
    await pull();
    onDevice(B);
    await pull();

    const occurrenceSyncId = skipped.occurrence.syncId!;
    for (const device of [A, B]) {
      onDevice(device);
      expect(occurrenceStatus(occurrenceSyncId)).toBe('generated');
      expect(transactionsFor(occurrenceSyncId)).toBe(1);
    }
  });

  it('lets a downloaded generation replace a skip that has not been uploaded yet', async () => {
    onDevice(A);
    const generated = recurring.generateOccurrence(template.id, '2026-09-01', { asOfDate: AS_OF });
    await push();

    onDevice(B);
    recurring.skipOccurrence(localTemplate(template.syncId!).id, '2026-09-01', { asOfDate: AS_OF });
    const result = await pull();

    const occurrenceSyncId = generated.occurrence.syncId!;
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        entityType: 'recurring_occurrence',
        resolution: 'remote_wins',
        detail: 'generated_wins',
      }),
    );
    expect(occurrenceStatus(occurrenceSyncId)).toBe('generated');
    expect(transactionsFor(occurrenceSyncId)).toBe(1);
    // The stale skip was withdrawn, so there is nothing left to upload.
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('resolves two offline edits of one template to a single winner', async () => {
    onDevice(A);
    recurring.updateRecurringTemplate(template.id, { amountMinor: rupees(12_000) });
    onDevice(B);
    recurring.updateRecurringTemplate(localTemplate(template.syncId!).id, {
      amountMinor: rupees(15_000),
    });

    onDevice(A);
    await push();
    onDevice(B);
    await pull();
    await push();
    onDevice(A);
    await pull();

    const amounts: number[] = [];
    for (const device of [A, B]) {
      onDevice(device);
      amounts.push(localTemplate(template.syncId!).amountMinor);
      expect(count('recurring_templates')).toBe(1);
    }
    // One winner, the same on both, decided by the ordinary M7 rule.
    expect(amounts[0]).toBe(amounts[1]);
    expect(cloud.rows('recurring_template')).toHaveLength(1);
  });

  it('keeps a deletion over an offline edit of the same template', async () => {
    onDevice(A);
    recurring.deleteRecurringTemplate(template.id);
    await push();

    onDevice(B);
    recurring.updateRecurringTemplate(localTemplate(template.syncId!).id, { title: 'Renamed' });
    await pull();
    await push();

    for (const device of [A, B]) {
      onDevice(device);
      expect(recurring.listRecurringTemplates()).toEqual([]);
    }
    expect(
      (cloud.rowBySyncId('recurring_template', template.syncId!) as { deleted_at: number | null })
        .deleted_at,
    ).not.toBeNull();
  });

  it('keeps a transaction generated offline for a template deleted elsewhere', async () => {
    onDevice(A);
    recurring.deleteRecurringTemplate(template.id);
    await push();

    // B has not heard about the deletion and generates September.
    onDevice(B);
    const generated = recurring.generateOccurrence(
      localTemplate(template.syncId!).id,
      '2026-09-01',
      { asOfDate: AS_OF },
    );
    // Download first, as the orchestrator does: the deletion arrives.
    await pull();
    expect(recurring.listRecurringTemplates()).toEqual([]);
    expect((await push()).status).toBe('success');

    onDevice(A);
    const result = await pull();
    expect(result.failures).toEqual([]);

    const occurrenceSyncId = generated.occurrence.syncId!;
    for (const device of [A, B]) {
      onDevice(device);
      // The schedule is gone. The money that moved is not.
      expect(transactionsFor(occurrenceSyncId)).toBe(1);
      expect(recurring.listDueOccurrences({ asOfDate: AS_OF }).occurrences).toEqual([]);
      expect(localAccountBalance(fixture.bank.syncId!)).toBe(rupees(1_000_000 - 5_000));
    }
  });

  it('delivers a template created, used and deleted while the other device was away', async () => {
    onDevice(A);
    const passing = createGroceryRun(fixture, { startDate: '2026-08-10', title: 'One-off' });
    const generated = recurring.generateOccurrence(passing.id, '2026-08-10', { asOfDate: AS_OF });
    recurring.deleteRecurringTemplate(passing.id);
    await push();

    // B has never seen this template, and it arrives already deleted. Its
    // occurrence and transaction still have to land.
    onDevice(B);
    const result = await pull();

    expect(result.failures).toEqual([]);
    expect(occurrenceStatus(generated.occurrence.syncId!)).toBe('generated');
    expect(transactionsFor(generated.occurrence.syncId!)).toBe(1);
    expect(count('recurring_templates', 'deleted_at IS NOT NULL')).toBe(1);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });
});

describe('recurring data and a first cloud link', () => {
  beforeEach(async () => {
    cloud = createFakeCloud();
    await setupDatabase();
    fixture = buildRecurringFixture();
  });
  afterAll(() => closeTestDatabase());

  it('counts a recurring template as data worth protecting', () => {
    createGroceryRun(fixture);
    expect(readLocalDataInventory().recurringTemplates).toBe(1);
    expect(
      summarizeCloudInventory({
        accounts: 0,
        transactions: 0,
        people: 0,
        customCategories: 0,
        budgets: 0,
        recurringTemplates: 1,
        settingsCurrency: null,
      }).hasMeaningfulData,
    ).toBe(true);
  });

  it('uploads existing templates and their history when this device’s data is chosen', async () => {
    // Created before any link, so nothing is queued: the first link reads the dataset.
    const template = createGroceryRun(fixture);
    const generated = recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.skipOccurrence(template.id, '2026-07-15', { asOfDate: AS_OF });

    const result = await linkUsingLocalData(reconcile());

    expect(result.status).toBe('linked');
    expect(cloud.rows('recurring_template')).toHaveLength(1);
    expect(cloud.rows('recurring_occurrence')).toHaveLength(2);
    expect(
      cloud.rowBySyncId(
        'transaction',
        deriveGeneratedTransactionSyncId(generated.occurrence.syncId!),
      ),
    ).toMatchObject({ recurring_occurrence_sync_id: generated.occurrence.syncId });
    expect(countPendingSyncMutations()).toBe(0);
  });

  it('restores templates and history onto a new device with the same due list', async () => {
    const rent = createGroceryRun(fixture);
    const salary = recurring.createRecurringTemplate({
      type: 'income',
      amountMinor: rupees(65_000),
      categoryId: fixture.salary.id,
      accountId: fixture.bank.id,
      startDate: '2026-07-01',
      frequency: 'monthly',
    });
    recurring.generateOccurrence(rent.id, '2026-06-15', { asOfDate: AS_OF });
    recurring.skipOccurrence(rent.id, '2026-07-15', { asOfDate: AS_OF });
    recurring.generateOccurrence(salary.id, '2026-07-01', { asOfDate: AS_OF });
    await linkUsingLocalData(reconcile());
    const expected = recurring
      .listDueOccurrences({ asOfDate: AS_OF })
      .occurrences.map((item) => [item.templateSyncId, item.occurrenceDate]);
    const expectedBalance = getAccountBalance(fixture.bank.id);

    await setupDevice(B);
    const restore = await linkUsingCloudData(reconcile());

    expect(restore.status).toBe('linked');
    expect(
      recurring
        .listDueOccurrences({ asOfDate: AS_OF })
        .occurrences.map((item) => [item.templateSyncId, item.occurrenceDate]),
    ).toEqual(expected);
    expect(localAccountBalance(fixture.bank.syncId!)).toBe(expectedBalance);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(2);
    expect(verifySyncIntegrity().issues).toEqual([]);
  });

  it('retires cloud recurring data this device does not have when its data is chosen', async () => {
    const template = cloudRecurringTemplate({
      category_sync_id: fixture.food.syncId!,
      account_sync_id: fixture.bank.syncId!,
    });
    const occurrence = cloudRecurringOccurrence({
      template_sync_id: template.sync_id,
      occurrence_date: '2026-06-15',
      status: 'skipped',
    });
    cloud.putRow('recurring_template', template);
    cloud.putRow('recurring_occurrence', occurrence);

    await linkUsingLocalData(reconcile());

    // A replacement: left behind, these would be downloaded straight back.
    for (const [entityType, syncId] of [
      ['recurring_template', template.sync_id],
      ['recurring_occurrence', occurrence.sync_id],
    ] as const) {
      expect(
        (cloud.rowBySyncId(entityType, syncId) as { deleted_at: number | null }).deleted_at,
      ).not.toBeNull();
    }
    expect(recurring.listRecurringTemplates()).toEqual([]);
  });

  it('leaves no local recurring data behind when the cloud’s data replaces it', async () => {
    const template = createGroceryRun(fixture);
    recurring.generateOccurrence(template.id, '2026-06-15', { asOfDate: AS_OF });

    const result = await linkUsingCloudData(reconcile());

    expect(result.status).toBe('linked');
    expect(count('recurring_templates')).toBe(0);
    expect(count('recurring_occurrences')).toBe(0);
    expect(count('transactions', 'recurring_occurrence_id IS NOT NULL')).toBe(0);
  });
});

describe('the occurrence identity every device derives', () => {
  it('is the same function of template and date the engine uses', () => {
    const templateSyncId = cloudSyncId();
    expect(
      cloudRecurringOccurrence({ template_sync_id: templateSyncId, occurrence_date: '2026-09-01' })
        .sync_id,
    ).toBe(deriveOccurrenceSyncId(templateSyncId, '2026-09-01'));
  });
});
