/** Where a recovery snapshot is written. Injected so tests never touch a disk. */
export type SafetyBackupStore = {
  /** Returns an opaque location for diagnostics. Never shown as a file path to users. */
  write(name: string, content: string): Promise<string>;
};

/** Why a snapshot was taken, which also names the file. */
export const SAFETY_BACKUP_REASONS = [
  'pre-cloud-link',
  'pre-cloud-restore',
  'pre-cloud-replace',
] as const;

export type SafetyBackupReason = (typeof SAFETY_BACKUP_REASONS)[number];
