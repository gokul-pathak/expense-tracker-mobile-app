import type { db } from '@/db';
import type { SyncEntityType, SyncOperation } from '@/db/schema';

export {
  MUTATION_ORIGINS,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS,
  isSyncEntityType,
  isSyncOperation,
} from '@/db/schema';
export type { MutationOrigin, SyncEntityType, SyncOperation, SyncOutboxEntry } from '@/db/schema';

type Database = typeof db;
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A database handle that can carry a domain mutation and its outbox mutation.
 * Domain repositories pass their open transaction so both commit together.
 */
export type SyncWriter = Pick<DatabaseTransaction, 'select' | 'insert' | 'update' | 'delete'>;

export type SyncMutation = {
  entityType: SyncEntityType;
  entitySyncId: string;
  operation: SyncOperation;
  /** Defaults to now. Outbox order is queue order, never a financial date. */
  createdAt?: Date;
};
