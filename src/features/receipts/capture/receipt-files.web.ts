/**
 * Receipt working files on web: there are none.
 *
 * Web has no on-device OCR (see `ocr/receipt-ocr.ts`) and this app's SQLite
 * layer is already closed there, so nothing on web ever stages a receipt. The
 * queries still answer honestly rather than throwing, so a shared code path
 * that asks "does this file still exist" gets `false` instead of a crash.
 */

export async function stageReceiptFile(): Promise<string> {
  throw new Error('Receipt capture is available in the Android and iOS app.');
}

export async function receiptFileExists(): Promise<boolean> {
  return false;
}

export async function receiptFileSize(): Promise<number | undefined> {
  return undefined;
}

export async function deleteReceiptFile(): Promise<void> {
  // Nothing was ever written.
}

export async function deleteStaleReceiptFiles(): Promise<number> {
  return 0;
}

export async function clearReceiptWorkingDirectory(): Promise<void> {
  // Nothing was ever written.
}
