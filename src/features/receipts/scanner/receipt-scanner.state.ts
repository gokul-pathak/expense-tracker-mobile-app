import type { ReceiptFailureReason } from '../receipt.types';

/**
 * The scanner, as one value rather than a handful of booleans.
 *
 * `isLoading`, `isCamera`, `hasImage` and `isOcr` look harmless one at a time
 * and together describe states that cannot exist — loading with no image,
 * reading text with the camera still open — which is where scanner bugs come
 * from. Here every screen the scanner can show is exactly one variant, and the
 * reducer is the only thing that moves between them.
 *
 * Pure: no navigation, no capture, no OCR. The screen performs those and
 * reports back with an event. That keeps every transition in this file, and
 * every transition testable without a phone.
 *
 * `run` is the stale-result guard. Starting a capture, retrying, choosing
 * another photo or leaving all bump it, and a result that arrives carrying an
 * older run is ignored. So a slow read of a receipt someone has already
 * abandoned can never pull them back into a review they walked away from.
 */

export type ReceiptSource = 'camera' | 'library';

export type ScannerState =
  /** The Take Photo / Choose from Photos / Cancel choice. */
  | { status: 'selecting_source' }
  /** The camera or the photo picker is open. */
  | { status: 'capturing'; source: ReceiptSource }
  | { status: 'processing'; source: ReceiptSource; draftId: number }
  | { status: 'permission_denied'; source: ReceiptSource }
  | { status: 'unsupported_image' }
  /** No OCR engine on this build. Not a failure of this receipt. */
  | { status: 'unavailable' }
  | {
      status: 'failed';
      source: ReceiptSource;
      draftId: number;
      reason: ReceiptFailureReason;
      /** False when the photo itself is gone, so reading it again is impossible. */
      canRetry: boolean;
    }
  /** Read. The screen hands over to Review Receipt. */
  | { status: 'ready'; draftId: number }
  /** Left. The screen goes back. */
  | { status: 'cancelled' };

export type Scanner = { run: number; state: ScannerState };

/** What capture produced, reduced to what the scanner needs to decide. */
export type CaptureSummary =
  | { status: 'captured'; draftId: number }
  | { status: 'cancelled' }
  | { status: 'permission_denied' }
  | { status: 'unsupported_image' }
  | { status: 'unavailable' };

export type ProcessingSummary =
  | { status: 'ready_for_review' }
  | { status: 'failed'; reason: ReceiptFailureReason }
  /** Another run owns the draft now; its result is the one that counts. */
  | { status: 'superseded' };

export type ScannerEvent =
  | { type: 'choose_source'; source: ReceiptSource }
  | { type: 'capture_finished'; run: number; result: CaptureSummary }
  | { type: 'processing_finished'; run: number; draftId: number; result: ProcessingSummary }
  | { type: 'retry' }
  | { type: 'choose_another' }
  | { type: 'cancel' };

export const initialScanner: Scanner = { run: 0, state: { status: 'selecting_source' } };

export function scannerReducer(scanner: Scanner, event: ScannerEvent): Scanner {
  const { state } = scanner;

  switch (event.type) {
    case 'choose_source':
      // From the choice itself, and from a refused camera, where "Choose from
      // Photos" is the way forward. Nowhere else: a second capture must never
      // start on top of one already open.
      if (state.status !== 'selecting_source' && state.status !== 'permission_denied') {
        return scanner;
      }
      return next(scanner, { status: 'capturing', source: event.source });

    case 'capture_finished': {
      if (event.run !== scanner.run || state.status !== 'capturing') return scanner;
      const { result } = event;
      switch (result.status) {
        case 'captured':
          return {
            run: scanner.run,
            state: { status: 'processing', source: state.source, draftId: result.draftId },
          };
        case 'cancelled':
          // Backing out of the camera is a decision, not a failure. The choice
          // they came from is shown again, with no error anywhere.
          return { run: scanner.run, state: { status: 'selecting_source' } };
        case 'permission_denied':
          return { run: scanner.run, state: { status: 'permission_denied', source: state.source } };
        case 'unsupported_image':
          return { run: scanner.run, state: { status: 'unsupported_image' } };
        case 'unavailable':
          return { run: scanner.run, state: { status: 'unavailable' } };
      }
      return scanner;
    }

    case 'processing_finished': {
      if (
        event.run !== scanner.run ||
        state.status !== 'processing' ||
        state.draftId !== event.draftId
      ) {
        return scanner;
      }
      const { result } = event;
      if (result.status === 'superseded') return scanner;
      if (result.status === 'ready_for_review') {
        return { run: scanner.run, state: { status: 'ready', draftId: state.draftId } };
      }
      // No engine is a property of the build, not of this receipt, so it is
      // reported as such rather than as "we couldn't read this".
      if (result.reason === 'ocr_provider_unavailable') {
        return { run: scanner.run, state: { status: 'unavailable' } };
      }
      return {
        run: scanner.run,
        state: {
          status: 'failed',
          source: state.source,
          draftId: state.draftId,
          reason: result.reason,
          canRetry: result.reason !== 'image_unavailable',
        },
      };
    }

    case 'retry':
      if (state.status !== 'failed' || !state.canRetry) return scanner;
      // The same draft and the same photo: no second draft, no new capture.
      return next(scanner, {
        status: 'processing',
        source: state.source,
        draftId: state.draftId,
      });

    case 'choose_another':
      if (
        state.status !== 'failed' &&
        state.status !== 'unsupported_image' &&
        state.status !== 'permission_denied'
      ) {
        return scanner;
      }
      return next(scanner, { status: 'selecting_source' });

    case 'cancel':
      // Bumping the run is what makes leaving safe: whatever is still reading
      // will finish into a run nobody is listening for.
      return next(scanner, { status: 'cancelled' });
  }
}

/** The draft a state holds, so a screen abandoning it can discard it. */
export function draftOf(state: ScannerState): number | null {
  return state.status === 'processing' || state.status === 'failed' || state.status === 'ready'
    ? state.draftId
    : null;
}

function next(scanner: Scanner, state: ScannerState): Scanner {
  return { run: scanner.run + 1, state };
}
