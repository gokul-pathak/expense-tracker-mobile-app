import type { ReceiptImageAsset } from '../capture/receipt-capture.types';

/**
 * The boundary between "some engine read the picture" and everything else.
 *
 * Nothing downstream of this file knows which OCR engine ran, or whether one
 * ran at all. That matters for two reasons. The obvious one is that the engine
 * will change — ML Kit today, Apple Vision on iOS, something else in two
 * years. The less obvious one is that the parser and its fixtures must be
 * testable without a camera, a device or a native build, and they are: a fake
 * provider returning fixture text exercises the whole pipeline.
 *
 * The result type is deliberately small. An engine that offers bounding boxes
 * and per-word probabilities may report them, but nothing in M9A depends on
 * them, so an engine that offers neither is a first-class citizen rather than
 * a degraded one.
 */

/**
 * Whether OCR can run here at all.
 *
 * Not an error. A web build has no on-device OCR and never will; a user who
 * declined the permission has made a choice. Both are ordinary states the app
 * reports, and neither is a crash or a report to crash monitoring.
 */
export type OcrCapability =
  | { status: 'available' }
  | { status: 'unsupported'; reason: string }
  | { status: 'permission_denied' };

/**
 * What an engine read.
 *
 * `lines` is kept alongside `text` because receipt parsing lives and dies on
 * line structure — see `extraction/receipt-text.ts`. An engine that only
 * produces a blob should split it on newlines rather than leaving this empty.
 */
export type ReceiptOcrResult = {
  text: string;
  lines: string[];
  /** Which adapter produced this, for diagnostics. Never a secret. */
  provider: string;
  providerVersion?: string;
  /**
   * The engine's own confidence, when it genuinely reports one.
   *
   * Left undefined otherwise. It is never synthesized from the extractor's
   * heuristics: "the model was sure" and "the word TOTAL was next to it" are
   * different claims, and collapsing them would make both meaningless.
   */
  providerConfidence?: number;
};

export type ReceiptOcrProvider = {
  readonly id: string;
  /** Cheap enough to call before every run; may prompt for permission. */
  getCapability(): Promise<OcrCapability>;
  recognize(image: ReceiptImageAsset): Promise<ReceiptOcrResult>;
};

/**
 * The provider used when none has been registered.
 *
 * This is the honest default rather than a stub that throws. M9A ships without
 * a bundled OCR engine (see `docs/receipt-scanning-architecture.md` for why),
 * and on web there will never be one, so "no OCR here" has to be a state the
 * app can be in and describe — not a missing import that fails the bundle.
 */
export function createUnavailableOcrProvider(reason: string): ReceiptOcrProvider {
  return {
    id: 'unavailable',
    getCapability: async () => ({ status: 'unsupported', reason }),
    recognize: async () => {
      throw new OcrUnavailableError(reason);
    },
  };
}

export class OcrUnavailableError extends Error {
  readonly code = 'ocr_provider_unavailable';
  constructor(reason: string) {
    super(reason);
    this.name = 'OcrUnavailableError';
  }
}

const DEFAULT_REASON =
  'No on-device text recognition engine is installed in this build. See docs/receipt-scanning-architecture.md.';

let provider: ReceiptOcrProvider = createUnavailableOcrProvider(DEFAULT_REASON);

/**
 * Registers the engine for this build.
 *
 * A native adapter is wired in here at start-up, behind a platform check, so
 * that a web bundle never imports native code — importing it unconditionally
 * is what breaks the web build, not merely running it.
 */
export function setReceiptOcrProvider(next: ReceiptOcrProvider): void {
  provider = next;
}

export function getReceiptOcrProvider(): ReceiptOcrProvider {
  return provider;
}

/** Restores the unavailable default. Used between tests. */
export function resetReceiptOcrProvider(): void {
  provider = createUnavailableOcrProvider(DEFAULT_REASON);
}
