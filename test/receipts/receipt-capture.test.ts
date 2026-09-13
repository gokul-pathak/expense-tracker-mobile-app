import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The picker, replaced.
 *
 * `expo-image-picker` is a native module and cannot load in Node, which is
 * exactly why the capture service is the only file that imports it. Mocking it
 * here means the permission flow, the format rules and the staging step are
 * all testable on a laptop.
 */
const picker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock('expo-image-picker', () => picker);

const staged = vi.hoisted(() => [] as string[]);
vi.mock('@/features/receipts/capture/receipt-files', () => ({
  stageReceiptFile: async (uri: string, extension: string) => {
    const target = `file:///private/receipt-processing/copy-${staged.length}.${extension}`;
    staged.push(uri);
    return target;
  },
  receiptFileExists: async () => true,
  receiptFileSize: async () => undefined,
  deleteReceiptFile: async () => {},
  deleteStaleReceiptFiles: async () => 0,
  clearReceiptWorkingDirectory: async () => {},
}));

import {
  captureReceiptFromCamera,
  importReceiptFromLibrary,
} from '@/features/receipts/capture/receipt-capture.service';

const granted = { granted: true, canAskAgain: true, status: 'granted' };
const denied = { granted: false, canAskAgain: true, status: 'denied' };

const photo = (overrides: Record<string, unknown> = {}) => ({
  canceled: false,
  assets: [
    {
      uri: 'file:///tmp/picker/IMG_0001.jpg',
      mimeType: 'image/jpeg',
      width: 3024,
      height: 4032,
      fileSize: 2_400_000,
      ...overrides,
    },
  ],
});

describe('capturing from the camera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staged.length = 0;
    picker.requestCameraPermissionsAsync.mockResolvedValue(granted);
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue(granted);
  });

  it('copies the photo into the app’s own directory and normalizes the result', async () => {
    picker.launchCameraAsync.mockResolvedValue(photo());

    const outcome = await captureReceiptFromCamera();

    expect(outcome.status).toBe('captured');
    if (outcome.status !== 'captured') return;
    // The picker's own URI is never what the rest of the app holds on to.
    expect(outcome.asset.uri).toContain('receipt-processing');
    expect(outcome.asset.uri).not.toBe('file:///tmp/picker/IMG_0001.jpg');
    expect(staged).toEqual(['file:///tmp/picker/IMG_0001.jpg']);
    expect(outcome.asset).toMatchObject({ mimeType: 'image/jpeg', width: 3024, height: 4032 });
  });

  it('asks for the camera only when the camera is used', async () => {
    picker.launchCameraAsync.mockResolvedValue(photo());

    await captureReceiptFromCamera();

    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    // Importing from the library is a different decision and a different prompt.
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a refused permission without opening anything', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue(denied);

    const outcome = await captureReceiptFromCamera();

    expect(outcome).toEqual({ status: 'permission_denied', source: 'camera' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('treats backing out as a decision, not a failure', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });

    expect(await captureReceiptFromCamera()).toEqual({ status: 'cancelled' });
  });

  it('asks for images only, and never for audio', async () => {
    picker.launchCameraAsync.mockResolvedValue(photo());

    await captureReceiptFromCamera();

    const options = picker.launchCameraAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.mediaTypes).toEqual(['images']);
    // Reading a receipt needs no location, and asking for it would attach
    // where someone was to what they bought.
    expect(options.exif).toBe(false);
  });

  it('turns a picker crash into a state rather than an exception', async () => {
    picker.launchCameraAsync.mockRejectedValue(new Error('camera busy at /dev/video0'));

    const outcome = await captureReceiptFromCamera();

    expect(outcome.status).toBe('unavailable');
    // Only the classification crosses the boundary, never the message.
    if (outcome.status === 'unavailable') expect(outcome.reason).toBe('Error');
  });
});

describe('importing from the library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staged.length = 0;
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue(granted);
  });

  it('accepts a PNG and a HEIC as readily as a JPEG', async () => {
    for (const mimeType of ['image/png', 'image/heic']) {
      picker.launchImageLibraryAsync.mockResolvedValue(photo({ mimeType }));
      const outcome = await importReceiptFromLibrary();
      expect(outcome.status).toBe('captured');
    }
  });

  it('falls back to the file extension when the picker reports no type', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(
      photo({ mimeType: undefined, uri: 'file:///tmp/picker/scan.png' }),
    );

    const outcome = await importReceiptFromLibrary();

    expect(outcome.status).toBe('captured');
    if (outcome.status === 'captured') expect(outcome.asset.mimeType).toBe('image/png');
  });

  it('refuses a file that is not an image this app reads', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(
      photo({ mimeType: 'application/pdf', uri: 'file:///tmp/picker/bill.pdf' }),
    );

    // PDF receipts are a later feature, not something to half-support now.
    expect(await importReceiptFromLibrary()).toEqual({
      status: 'unsupported_image',
      mimeType: 'application/pdf',
    });
  });

  it('refuses an image too large to be a receipt, before reading it', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(photo({ fileSize: 40 * 1024 * 1024 }));

    const outcome = await importReceiptFromLibrary();

    expect(outcome.status).toBe('unsupported_image');
    // Nothing was copied, so nothing large ever entered the working directory.
    expect(staged).toEqual([]);
  });

  it('refuses an implausible pixel count', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(
      photo({ width: 30_000, height: 30_000, fileSize: 1_000 }),
    );

    expect((await importReceiptFromLibrary()).status).toBe('unsupported_image');
  });

  it('treats a cancelled picker as cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    expect(await importReceiptFromLibrary()).toEqual({ status: 'cancelled' });
  });
});
