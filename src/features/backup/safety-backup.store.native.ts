import * as FileSystem from 'expo-file-system/legacy';

import type { SafetyBackupStore } from './safety-backup.types';

const DIRECTORY_NAME = 'safety-backups';

/**
 * App-managed recovery snapshots.
 *
 * These are written into the app's own document directory rather than offered
 * through the share sheet: the user is in the middle of setting up cloud sync,
 * and interrupting that with a file picker to protect them from a step they did
 * not ask about is the wrong trade. The snapshot exists so the data can be
 * recovered, not so it can be filed away.
 */
export const safetyBackupStore: SafetyBackupStore = {
  async write(name, content) {
    const root = FileSystem.documentDirectory;
    if (root === null) throw new Error('This device has no writable storage for a safety backup.');
    const directory = `${root}${DIRECTORY_NAME}`;
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const uri = `${directory}/${name}`;
    await FileSystem.writeAsStringAsync(uri, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return uri;
  },
};
