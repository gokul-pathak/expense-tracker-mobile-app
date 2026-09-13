import * as ImagePicker from 'expo-image-picker';

import { stageReceiptFile } from './receipt-files';
import {
  isSupportedReceiptMimeType,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPT_PIXELS,
  mimeTypeFromUri,
  type ReceiptCaptureOutcome,
  type ReceiptCaptureSource,
  type ReceiptImageAsset,
} from './receipt-capture.types';

/**
 * Getting a receipt image, from the camera or the photo library.
 *
 * The only file in the app that knows `expo-image-picker` exists. Everything
 * downstream receives a `ReceiptImageAsset` pointing at a file this app owns,
 * so the picker can be replaced, and so a test can exercise the whole pipeline
 * with an object literal.
 *
 * Permissions are requested here and only here, at the moment the person asks
 * for the thing that needs them. Nothing is requested at start-up: an app that
 * asks for the camera before you have expressed any interest in the camera has
 * told you something about itself.
 */

/** Receipts are photographs of paper. Nothing here accepts video. */
const IMAGES_ONLY: ImagePicker.MediaType[] = ['images'];

/**
 * Quality below 1 so a 12-megapixel phone photo does not become a 10 MB file
 * on its way through, but high enough that small print survives. Receipt text
 * is the entire point; compressing until it blurs would save bytes and lose
 * the data.
 */
const CAPTURE_QUALITY = 0.8;

export async function captureReceiptFromCamera(): Promise<ReceiptCaptureOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'permission_denied', source: 'camera' };

  try {
    return await handle(
      await ImagePicker.launchCameraAsync({
        mediaTypes: IMAGES_ONLY,
        quality: CAPTURE_QUALITY,
        // The receipt is cropped by the person if they want it cropped; forcing
        // an editor in front of every capture slows down the common case.
        allowsEditing: false,
        // Location is of no use in reading a receipt, and asking for it would
        // attach where someone was to what they bought.
        exif: false,
      }),
    );
  } catch (error) {
    return { status: 'unavailable', reason: describe(error) };
  }
}

export async function importReceiptFromLibrary(): Promise<ReceiptCaptureOutcome> {
  // On current Android and iOS the system picker needs no permission of its
  // own; where the platform still asks, this is the moment to ask.
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    return { status: 'permission_denied', source: 'library' };
  }

  try {
    return await handle(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGES_ONLY,
        quality: CAPTURE_QUALITY,
        allowsEditing: false,
        allowsMultipleSelection: false,
        exif: false,
      }),
    );
  } catch (error) {
    return { status: 'unavailable', reason: describe(error) };
  }
}

async function handle(result: ImagePicker.ImagePickerResult): Promise<ReceiptCaptureOutcome> {
  // Backing out is a decision, not a failure.
  if (result.canceled) return { status: 'cancelled' };

  const picked = result.assets[0];
  if (picked === undefined) return { status: 'cancelled' };

  const mimeType = picked.mimeType ?? mimeTypeFromUri(picked.uri);
  if (!isSupportedReceiptMimeType(mimeType)) {
    return { status: 'unsupported_image', mimeType: mimeType ?? null };
  }

  // Refused before anything reads it. A file this large is not a receipt, and
  // the point of checking is to avoid finding out by running out of memory.
  if (picked.fileSize !== undefined && picked.fileSize > MAX_RECEIPT_BYTES) {
    return { status: 'unsupported_image', mimeType: mimeType ?? null };
  }
  if (picked.width * picked.height > MAX_RECEIPT_PIXELS) {
    return { status: 'unsupported_image', mimeType: mimeType ?? null };
  }

  const uri = await stageReceiptFile(picked.uri, extensionFor(mimeType!));
  const asset: ReceiptImageAsset = {
    uri,
    mimeType: mimeType!,
    // The picker reports the dimensions after its own orientation handling, so
    // a receipt photographed sideways arrives the right way up.
    width: picked.width,
    height: picked.height,
    ...(picked.fileSize === undefined ? {} : { fileSize: picked.fileSize }),
  };
  return { status: 'captured', asset };
}

function extensionFor(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'jpg';
  }
}

/**
 * A classification, never the payload.
 *
 * Picker failures can carry a URI, and a URI can carry a filename someone
 * chose. Only the error's name crosses this boundary.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown_capture_error';
}

export type { ReceiptCaptureSource };
