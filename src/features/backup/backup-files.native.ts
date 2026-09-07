import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { createBackup, parseAndValidateBackup, restoreBackup } from './backup.service';
import { getBackupPreview } from './backup.validation';
import type { BackupPreview } from './backup.types';
import {
  exportFullDataJson,
  exportTransactionsCsv,
  exportTransactionsJson,
} from '@/features/export/export.service';

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export async function shareTransactionsCsv() {
  return shareText(
    exportTransactionsCsv(),
    `expense-tracker-transactions-${fileDate()}.csv`,
    'text/csv',
  );
}
export async function shareTransactionsJson() {
  return shareText(
    exportTransactionsJson(),
    `expense-tracker-transactions-${fileDate()}.json`,
    'application/json',
  );
}
export async function shareFullDataJson() {
  return shareText(
    exportFullDataJson(),
    `expense-tracker-export-${fileDate()}.json`,
    'application/json',
  );
}
export async function createAndShareBackup() {
  return shareText(
    JSON.stringify(createBackup(), null, 2),
    `expense-tracker-backup-${fileDate()}.json`,
    'application/json',
  );
}

export async function chooseBackup(): Promise<{ text: string; preview: BackupPreview } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error('No backup file was selected.');
  if (asset.size !== undefined && asset.size > MAX_BACKUP_BYTES)
    throw new Error('Backup files must be 25 MB or smaller.');
  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists) throw new Error('The selected backup file could not be read.');
  const text = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const backup = parseAndValidateBackup(text);
  return { text, preview: getBackupPreview(backup) };
}

export function restoreChosenBackup(text: string) {
  restoreBackup(parseAndValidateBackup(text));
}

async function shareText(content: string, filename: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Sharing is not available on this device.');
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Temporary file storage is unavailable.');
  const uri = `${directory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Save or share your export' });
}

function fileDate() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
