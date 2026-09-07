import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import { PushRemoteError } from '@/features/sync/remote/supabase-sync.repository';
import { pushPendingChanges } from '@/features/sync/push-sync.service';
import { countPendingSyncMutations, updateSyncState } from '@/features/sync/sync.repository';
import * as transactionService from '@/features/transactions/transaction.service';

import { expenseCategory, makeAccount, setupDatabase } from '../support/domain';
import { createFakeCloud, type FakeCloud } from '../support/fake-cloud';
import { closeTestDatabase } from '../support/test-database';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const date = new Date(2026, 0, 15);

let cloud: FakeCloud;

function push(userId: string | null, overrides: { remoteAvailable?: boolean } = {}) {
  return pushPendingChanges({
    dependencies: {
      getAuthenticatedUserId: async () => userId,
      createRemote: () => (overrides.remoteAvailable === false ? null : cloud.repository),
    },
  });
}

/** Ten queued operations spread across parents and transactions. */
function queuePendingWork() {
  const cash = makeAccount('Cash', 'NPR', 100000);
  const bank = makeAccount('Bank', 'NPR', 500000);
  for (let index = 0; index < 8; index += 1) {
    transactionService.createExpense({
      accountId: index % 2 === 0 ? cash.id : bank.id,
      categoryId: expenseCategory().id,
      amountMinor: 100 + index,
      title: `Expense ${index}`,
      paymentMode: 'cash',
      transactionDate: date,
    });
  }
}

describe('push eligibility', () => {
  beforeEach(async () => {
    await setupDatabase();
    cloud = createFakeCloud();
  });
  afterAll(() => closeTestDatabase());

  it('reports an unavailable engine when this build has no cloud configuration', async () => {
    queuePendingWork();

    const result = await push(USER_A, { remoteAvailable: false });

    expect(result.status).toBe('unavailable');
    expect(result.processed).toBe(0);
    expect(countPendingSyncMutations()).toBe(10);
  });

  it('leaves every queued operation pending while signed out', async () => {
    queuePendingWork();
    updateSyncState({ linkedUserId: USER_A });

    const result = await push(null);

    expect(result.status).toBe('auth_required');
    expect(cloud.calls).toHaveLength(0);
    expect(result.remaining).toBe(10);
    expect(countPendingSyncMutations()).toBe(10);
  });

  it('uploads nothing for an authenticated user whose database is not linked', async () => {
    queuePendingWork();

    const result = await push(USER_A);

    // Signing in must never publish an existing local database on its own.
    expect(result.status).toBe('not_linked');
    expect(cloud.calls).toHaveLength(0);
    expect(countPendingSyncMutations()).toBe(10);
  });

  it('refuses to push when a different account is signed in', async () => {
    queuePendingWork();
    updateSyncState({ linkedUserId: USER_A });

    const result = await push(USER_B);

    expect(result.status).toBe('account_mismatch');
    expect(cloud.calls).toHaveLength(0);
    // The queue is preserved for the rightful account, and nothing is relinked.
    expect(countPendingSyncMutations()).toBe(10);
  });

  it('treats an unusable session as auth_required rather than failing the app', async () => {
    queuePendingWork();
    updateSyncState({ linkedUserId: USER_A });

    const result = await pushPendingChanges({
      dependencies: {
        getAuthenticatedUserId: async () => {
          throw new Error('session refresh failed');
        },
        createRemote: () => cloud.repository,
      },
    });

    // The auth layer owns refresh; push only reports that it cannot proceed.
    expect(result.status).toBe('auth_required');
    expect(cloud.calls).toHaveLength(0);
    expect(countPendingSyncMutations()).toBe(10);
  });

  it('stops mid-run when the session disappears, keeping confirmed work acknowledged', async () => {
    queuePendingWork();
    updateSyncState({ linkedUserId: USER_A });
    // Parents upload, then the session expires before the transactions phase.
    cloud.failWith((call) =>
      call.entityType === 'transaction' ? new PushRemoteError('auth', 'PGRST301') : undefined,
    );

    const result = await push(USER_A);

    expect(result.status).toBe('auth_required');
    expect(cloud.rows('account')).toHaveLength(2);
    expect(cloud.rows('transaction')).toHaveLength(0);
    expect(countPendingSyncMutations()).toBe(8);
  });

  it('is idle when a linked account has nothing queued', async () => {
    updateSyncState({ linkedUserId: USER_A });

    const result = await push(USER_A);

    expect(result.status).toBe('idle');
    expect(result.processed).toBe(0);
    expect(cloud.calls).toHaveLength(0);
  });
});
