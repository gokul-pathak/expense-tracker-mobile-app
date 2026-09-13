/**
 * What the rest of the app is allowed to know about a picked image.
 *
 * The picker's own result shape is a third-party type with a dozen fields that
 * change between SDK versions. Normalising at the boundary means the OCR
 * adapters, the processing service and every test deal in one small type that
 * this project controls — and that a test can construct by hand without
 * pretending to be Expo.
 */
export type ReceiptImageAsset = {
  /** A file URI inside the app's own private working directory. */
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize?: number;
};

/** Image types worth handing to an OCR engine. Anything else is refused. */
export const SUPPORTED_RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

/**
 * Where a receipt image came from. Permission is asked for per source and only
 * at the moment it is needed.
 */
export type ReceiptCaptureSource = 'camera' | 'library';

/**
 * The result of asking for an image.
 *
 * Cancelling is a first-class outcome, not an error: a person who opens the
 * camera and changes their mind has done nothing wrong, and reporting that to
 * crash monitoring would be noise about a normal Tuesday.
 */
export type ReceiptCaptureOutcome =
  | { status: 'captured'; asset: ReceiptImageAsset }
  | { status: 'cancelled' }
  | { status: 'permission_denied'; source: ReceiptCaptureSource }
  | { status: 'unsupported_image'; mimeType: string | null }
  | { status: 'unavailable'; reason: string };

/**
 * Beyond this, an image is a photograph of something other than a receipt, or
 * a decompression bomb. Either way it is refused before anything tries to read
 * it into memory.
 */
export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;
export const MAX_RECEIPT_PIXELS = 60_000_000;

export function isSupportedReceiptMimeType(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== 'string') return false;
  return (SUPPORTED_RECEIPT_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/**
 * Guesses a mime type from a file extension.
 *
 * The library picker does not always report one, and refusing every image
 * whose type the picker omitted would make import unusable on some devices.
 * The extension is a weaker signal than a reported type, so it is only ever
 * consulted as a fallback.
 */
export function mimeTypeFromUri(uri: string): string | null {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri);
  const extension = match?.[1]?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return null;
  }
}
