import * as FileSystem from 'expo-file-system/legacy';

/**
 * The working directory for receipt images, and its whole lifecycle.
 *
 * A picked image lives wherever the picker put it — a shared cache, a
 * provider URI, somewhere the OS may reclaim between the pick and the read. So
 * the first thing that happens to a receipt is a copy into a directory this
 * app controls, inside its own sandbox, never a shared or public folder.
 *
 * These files are processing artifacts, not financial records. Nothing here is
 * a backup, nothing syncs, and the app must survive every one of them
 * vanishing — the OS empties caches when storage runs short and does not ask
 * first. `exists` is therefore a question worth asking before every read, and
 * a missing file is an ordinary state rather than a corruption.
 */

const DIRECTORY_NAME = 'receipt-processing';

function directory(): string {
  const cache = FileSystem.cacheDirectory;
  if (cache === null || cache === undefined) {
    throw new Error('Temporary file storage is unavailable on this device.');
  }
  return `${cache}${DIRECTORY_NAME}/`;
}

async function ensureDirectory(): Promise<string> {
  const path = directory();
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
  return path;
}

/**
 * Copies a picked image into the working directory and returns the new URI.
 *
 * The name is random rather than derived from the original: a picker URI can
 * carry a filename chosen by another app, and building a path out of it is how
 * a traversal gets in.
 */
export async function stageReceiptFile(sourceUri: string, extension: string): Promise<string> {
  const path = await ensureDirectory();
  const safeExtension = /^[a-z0-9]{1,5}$/i.test(extension) ? extension.toLowerCase() : 'jpg';
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${safeExtension}`;
  const target = `${path}${name}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

/** Whether the working copy is still there. The cache may have been emptied. */
export async function receiptFileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

export async function receiptFileSize(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/** Deleting an image that is already gone is success, not failure. */
export async function deleteReceiptFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // A file the OS already reclaimed needs no further attention.
  }
}

/**
 * Removes working files at least `maxAgeMs` old that no draft refers to.
 *
 * Only this directory, and only images: it has no idea what a transaction is
 * and cannot reach one. `keep` holds the images live drafts point at, which are
 * never removed here whatever their age; the draft sweep in
 * `receipt-processing.service.ts` is the one that knows which drafts are live.
 */
export async function deleteStaleReceiptFiles(
  maxAgeMs: number,
  keep: ReadonlySet<string>,
  now = Date.now(),
): Promise<number> {
  const path = directory();
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return 0;

  const names = await FileSystem.readDirectoryAsync(path);
  let removed = 0;
  for (const name of names) {
    const uri = `${path}${name}`;
    if (keep.has(uri)) continue;
    const file = await FileSystem.getInfoAsync(uri);
    if (!file.exists) continue;
    const modified = (file.modificationTime ?? 0) * 1000;
    if (now - modified < maxAgeMs) continue;
    await deleteReceiptFile(uri);
    removed += 1;
  }
  return removed;
}

/** Empties the whole working directory. Used when receipt processing is turned off. */
export async function clearReceiptWorkingDirectory(): Promise<void> {
  await FileSystem.deleteAsync(directory(), { idempotent: true });
}
