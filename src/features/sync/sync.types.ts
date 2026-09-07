export const SYNC_ENTITY_TYPES = [
  'account',
  'category',
  'person',
  'transaction',
  'settings',
] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export const SYNC_OPERATIONS = ['upsert', 'delete'] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];
